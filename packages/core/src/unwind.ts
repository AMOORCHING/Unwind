import { randomUUID } from "node:crypto";
import { SQLiteEventStore } from "./store.js";
import type { EventStore } from "./store.js";
import type { UnwindRun } from "./types.js";
import { defineTool, type ArgSchema, type ToolOptions, type UnwindTool } from "./tool.js";
import { dispatch as dispatchFn, type ApprovalGate } from "./dispatch.js";
import { compensate as compensateFn, getCompensationSummary as getSummaryFn, type CompensationSummary } from "./compensate.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

type StoreConfig =
  | { store: "sqlite"; dbPath: string }
  | { store: "custom"; adapter: EventStore };

interface UnwindConfig {
  approvalGate?: ApprovalGate;
}

// ---------------------------------------------------------------------------
// Unwind class
// ---------------------------------------------------------------------------

export class Unwind {
  private eventStore: EventStore;
  private approvalGate?: ApprovalGate;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toolRegistry = new Map<string, UnwindTool<any>>();

  constructor(storeConfig: StoreConfig) {
    if (storeConfig.store === "sqlite") {
      this.eventStore = new SQLiteEventStore(storeConfig.dbPath);
    } else {
      this.eventStore = storeConfig.adapter;
    }
  }

  /** Register configuration options. */
  configure(config: UnwindConfig): void {
    this.approvalGate = config.approvalGate;
  }

  /** Wrap a tool definition and return a managed tool object. */
  tool<A extends ArgSchema>(options: ToolOptions<A>): UnwindTool<A> {
    const t = defineTool(options);
    this.toolRegistry.set(options.name, t);
    return t;
  }

  /** Create a new run and return its ID. */
  startRun(agentId: string): string {
    const runId = randomUUID();
    this.eventStore.createRun({
      id: runId,
      agentId,
      status: "active",
      createdAt: new Date().toISOString(),
    });
    return runId;
  }

  /** Dispatch a tool call through the middleware pipeline. */
  async dispatch(
    runId: string,
    stepIndex: number,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tool: UnwindTool<any>,
    args: Record<string, unknown>
  ): Promise<unknown> {
    return dispatchFn(
      this.eventStore,
      runId,
      stepIndex,
      tool,
      args,
      this.approvalGate
    );
  }

  /** Retrieve a run with its events. */
  getRun(runId: string): UnwindRun | null {
    return this.eventStore.getRun(runId);
  }

  /** Run compensation for a failed run. */
  async compensate(runId: string): Promise<CompensationSummary> {
    return compensateFn(this.eventStore, runId, this.toolRegistry);
  }

  /** Get a structured summary of compensation results for a run. */
  getCompensationSummary(runId: string): CompensationSummary {
    return getSummaryFn(this.eventStore, runId);
  }

  /** Close the underlying store. */
  close(): void {
    this.eventStore.close();
  }
}

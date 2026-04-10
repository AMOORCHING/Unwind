import { randomUUID } from "node:crypto";
import type { EventStore } from "./store.js";
import type {
  ApprovalReceived,
  ApprovalRequested,
  ToolCallCompleted,
  ToolCallFailed,
  ToolCallTracked,
} from "./types.js";
import type { UnwindTool } from "./tool.js";
import { extractStableArgs, generateIdempotencyKey } from "./idempotency.js";

// ---------------------------------------------------------------------------
// Approval gate type
// ---------------------------------------------------------------------------

export type ApprovalGate = (toolCall: {
  toolName: string;
  args: Record<string, unknown>;
  effectClass: string;
}) => Promise<boolean>;

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

export async function dispatch(
  store: EventStore,
  runId: string,
  stepIndex: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool: UnwindTool<any>,
  args: Record<string, unknown>,
  approvalGate?: ApprovalGate
): Promise<unknown> {
  const run = store.getRun(runId);
  if (run && run.forkFromStep !== undefined && stepIndex < run.forkFromStep) {
    const replayed = run.events.find(
      (e): e is ToolCallCompleted =>
        e.type === "ToolCallCompleted" && e.stepIndex === stepIndex
    );
    if (replayed) {
      return replayed.result;
    }
    throw new Error(
      `Forked run "${runId}": no replayed result for step ${stepIndex} (fork checkpoint is step ${run.forkFromStep})`
    );
  }

  const def = tool.definition;

  // 1. Generate idempotency key
  const idempotencyKey = generateIdempotencyKey(
    runId,
    stepIndex,
    def.name,
    args,
    def.args
  );

  // 2. Check event store for cached result
  const existingEvents = store.getEvents(runId);
  const cached = existingEvents.find(
    (e): e is ToolCallCompleted =>
      e.type === "ToolCallCompleted" &&
      // find the matching tracked event by idempotency key
      existingEvents.some(
        (t) =>
          t.type === "ToolCallTracked" &&
          (t as ToolCallTracked).idempotencyKey === idempotencyKey &&
          (t as ToolCallTracked).toolCallId === e.toolCallId
      )
  );

  if (cached) {
    return cached.result;
  }

  const toolCallId = randomUUID();
  const now = () => new Date().toISOString();

  // 3. Destructive tools require approval gate
  if (def.effectClass === "destructive") {
    if (!approvalGate) {
      // Log failure and throw
      const failEvent: ToolCallFailed = {
        type: "ToolCallFailed",
        eventId: randomUUID(),
        stepIndex,
        timestamp: now(),
        toolCallId,
        error: "No approval gate configured for destructive tool",
        reason: "approval_denied",
      };
      store.appendEvent(runId, failEvent);
      throw new Error(
        `Destructive tool "${def.name}" requires an approval gate but none is configured`
      );
    }

    // Log approval request
    const approvalRequestEvent: ApprovalRequested = {
      type: "ApprovalRequested",
      eventId: randomUUID(),
      stepIndex,
      timestamp: now(),
      toolCallId,
      toolName: def.name,
      args,
    };
    store.appendEvent(runId, approvalRequestEvent);

    const approved = await approvalGate({
      toolName: def.name,
      args,
      effectClass: def.effectClass,
    });

    // Log approval received
    const approvalReceivedEvent: ApprovalReceived = {
      type: "ApprovalReceived",
      eventId: randomUUID(),
      stepIndex,
      timestamp: now(),
      toolCallId,
      approved,
    };
    store.appendEvent(runId, approvalReceivedEvent);

    if (!approved) {
      const failEvent: ToolCallFailed = {
        type: "ToolCallFailed",
        eventId: randomUUID(),
        stepIndex,
        timestamp: now(),
        toolCallId,
        error: "Approval denied",
        reason: "approval_denied",
      };
      store.appendEvent(runId, failEvent);
      throw new Error(`Approval denied for destructive tool "${def.name}"`);
    }
  }

  // 4. Log ToolCallTracked
  const stableArgs = extractStableArgs(args, def.args);
  const trackedEvent: ToolCallTracked = {
    type: "ToolCallTracked",
    eventId: randomUUID(),
    stepIndex,
    timestamp: now(),
    toolCallId,
    toolName: def.name,
    effectClass: def.effectClass,
    args,
    stableArgs,
    idempotencyKey,
  };
  store.appendEvent(runId, trackedEvent);

  // 5. Execute
  const start = Date.now();
  try {
    const result = await tool.execute({ ...args, __idempotencyKey: idempotencyKey });
    const durationMs = Date.now() - start;

    // 6. Log ToolCallCompleted
    const completedEvent: ToolCallCompleted = {
      type: "ToolCallCompleted",
      eventId: randomUUID(),
      stepIndex,
      timestamp: now(),
      toolCallId,
      result,
      durationMs,
    };
    store.appendEvent(runId, completedEvent);

    return result;
  } catch (err) {
    // 7. Log ToolCallFailed
    const failedEvent: ToolCallFailed = {
      type: "ToolCallFailed",
      eventId: randomUUID(),
      stepIndex,
      timestamp: now(),
      toolCallId,
      error: err instanceof Error ? err.message : String(err),
      reason: "execution_error",
    };
    store.appendEvent(runId, failedEvent);

    throw err;
  }
}

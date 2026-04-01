import { randomUUID } from "node:crypto";
import type { EventStore } from "./store.js";
import type {
  ToolCallTracked,
  ToolCallCompleted,
  ToolCallFailed,
  CompensationStarted,
  CompensationCompleted,
  CompensationFailed,
} from "./types.js";
import type { UnwindTool } from "./tool.js";

// ---------------------------------------------------------------------------
// Compensation summary types
// ---------------------------------------------------------------------------

export interface CompensationSummary {
  compensated: Array<{
    toolName: string;
    toolCallId: string;
    compensationResult: unknown;
  }>;
  uncompensatable: Array<{
    toolName: string;
    toolCallId: string;
    reason: string;
    detail: string;
  }>;
  failed: Array<{
    toolName: string;
    toolCallId: string;
    error: string;
  }>;
  ambiguous: Array<{
    toolName: string;
    toolCallId: string;
    reason: string;
  }>;
}

// ---------------------------------------------------------------------------
// Tool registry type
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolRegistry = Map<string, UnwindTool<any>>;

// ---------------------------------------------------------------------------
// compensate
// ---------------------------------------------------------------------------

export async function compensate(
  store: EventStore,
  runId: string,
  toolRegistry: ToolRegistry
): Promise<CompensationSummary> {
  const events = store.getEvents(runId);
  const now = () => new Date().toISOString();

  // Update run status to "compensating"
  store.updateRunStatus(runId, "compensating");

  // Collect all ToolCallTracked events (needed for metadata lookup)
  const trackedByCallId = new Map<string, ToolCallTracked>();
  for (const e of events) {
    if (e.type === "ToolCallTracked") {
      trackedByCallId.set(e.toolCallId, e);
    }
  }

  // Collect all ToolCallCompleted events
  const completedByCallId = new Map<string, ToolCallCompleted>();
  for (const e of events) {
    if (e.type === "ToolCallCompleted") {
      completedByCallId.set(e.toolCallId, e);
    }
  }

  // Collect all ToolCallFailed events
  const failedByCallId = new Map<string, ToolCallFailed>();
  for (const e of events) {
    if (e.type === "ToolCallFailed") {
      failedByCallId.set(e.toolCallId, e);
    }
  }

  // Get completed tool calls in reverse chronological order
  // Sort by stepIndex desc, then by timestamp desc within a step
  const completedEntries = Array.from(completedByCallId.values()).sort(
    (a, b) => {
      if (b.stepIndex !== a.stepIndex) return b.stepIndex - a.stepIndex;
      return b.timestamp.localeCompare(a.timestamp);
    }
  );

  const summary: CompensationSummary = {
    compensated: [],
    uncompensatable: [],
    failed: [],
    ambiguous: [],
  };

  let hasCompensationFailure = false;
  let hasDestructive = false;

  // Process each completed tool call
  for (const completed of completedEntries) {
    const tracked = trackedByCallId.get(completed.toolCallId);
    if (!tracked) continue;

    const tool = toolRegistry.get(tracked.toolName);
    const effectClass = tracked.effectClass;

    if (effectClass === "idempotent") {
      // Skip — no side effect
      continue;
    }

    if (effectClass === "reversible") {
      // Log CompensationStarted
      const startEvent: CompensationStarted = {
        type: "CompensationStarted",
        eventId: randomUUID(),
        stepIndex: tracked.stepIndex,
        timestamp: now(),
        compensatingToolCallId: completed.toolCallId,
        compensationAction: `compensate:${tracked.toolName}`,
        args: tracked.args,
      };
      store.appendEvent(runId, startEvent);

      try {
        const compensateFn = tool?.compensate;
        if (!compensateFn) {
          throw new Error(
            `No compensate function found for reversible tool "${tracked.toolName}"`
          );
        }

        const start = Date.now();
        const result = await compensateFn(tracked.args, completed.result);
        const durationMs = Date.now() - start;

        // Log CompensationCompleted
        const completeEvent: CompensationCompleted = {
          type: "CompensationCompleted",
          eventId: randomUUID(),
          stepIndex: tracked.stepIndex,
          timestamp: now(),
          compensatingToolCallId: completed.toolCallId,
          result,
          durationMs,
        };
        store.appendEvent(runId, completeEvent);

        summary.compensated.push({
          toolName: tracked.toolName,
          toolCallId: completed.toolCallId,
          compensationResult: result,
        });
      } catch (err) {
        hasCompensationFailure = true;
        const errorMsg = err instanceof Error ? err.message : String(err);

        const failEvent: CompensationFailed = {
          type: "CompensationFailed",
          eventId: randomUUID(),
          stepIndex: tracked.stepIndex,
          timestamp: now(),
          compensatingToolCallId: completed.toolCallId,
          reason: "compensation_action_failed",
          detail: errorMsg,
        };
        store.appendEvent(runId, failEvent);

        summary.failed.push({
          toolName: tracked.toolName,
          toolCallId: completed.toolCallId,
          error: errorMsg,
        });
      }

      continue;
    }

    if (effectClass === "append-only") {
      const stableSummary = formatStableArgs(tracked.stableArgs);
      const detail = `${tracked.toolName}(${stableSummary}) — cannot be undone`;

      const failEvent: CompensationFailed = {
        type: "CompensationFailed",
        eventId: randomUUID(),
        stepIndex: tracked.stepIndex,
        timestamp: now(),
        compensatingToolCallId: completed.toolCallId,
        reason: "append_only_no_compensation",
        detail,
      };
      store.appendEvent(runId, failEvent);

      summary.uncompensatable.push({
        toolName: tracked.toolName,
        toolCallId: completed.toolCallId,
        reason: "append_only_no_compensation",
        detail,
      });

      continue;
    }

    if (effectClass === "destructive") {
      hasDestructive = true;
      const stableSummary = formatStableArgs(tracked.stableArgs);
      const detail = `${tracked.toolName}(${stableSummary}) — destructive action, requires human intervention`;

      const failEvent: CompensationFailed = {
        type: "CompensationFailed",
        eventId: randomUUID(),
        stepIndex: tracked.stepIndex,
        timestamp: now(),
        compensatingToolCallId: completed.toolCallId,
        reason: "destructive_escalation",
        detail,
      };
      store.appendEvent(runId, failEvent);

      summary.uncompensatable.push({
        toolName: tracked.toolName,
        toolCallId: completed.toolCallId,
        reason: "destructive_escalation",
        detail,
      });

      continue;
    }
  }

  // Handle ToolCallFailed with "timeout_side_effect_unknown"
  for (const [toolCallId, failed] of failedByCallId) {
    if (failed.reason === "timeout_side_effect_unknown") {
      const tracked = trackedByCallId.get(toolCallId);
      summary.ambiguous.push({
        toolName: tracked?.toolName ?? "unknown",
        toolCallId,
        reason: "timeout_side_effect_unknown",
      });
    }
  }

  // Determine final status
  let finalStatus: "compensated" | "partially_compensated";

  if (hasCompensationFailure || hasDestructive) {
    finalStatus = "partially_compensated";
  } else {
    finalStatus = "compensated";
  }

  store.updateRunStatus(runId, finalStatus);

  return summary;
}

// ---------------------------------------------------------------------------
// getCompensationSummary
// ---------------------------------------------------------------------------

export function getCompensationSummary(
  store: EventStore,
  runId: string
): CompensationSummary {
  const events = store.getEvents(runId);

  const trackedByCallId = new Map<string, ToolCallTracked>();
  for (const e of events) {
    if (e.type === "ToolCallTracked") {
      trackedByCallId.set(e.toolCallId, e);
    }
  }

  const failedByCallId = new Map<string, ToolCallFailed>();
  for (const e of events) {
    if (e.type === "ToolCallFailed") {
      failedByCallId.set(e.toolCallId, e);
    }
  }

  const summary: CompensationSummary = {
    compensated: [],
    uncompensatable: [],
    failed: [],
    ambiguous: [],
  };

  for (const e of events) {
    if (e.type === "CompensationCompleted") {
      const tracked = trackedByCallId.get(e.compensatingToolCallId);
      summary.compensated.push({
        toolName: tracked?.toolName ?? "unknown",
        toolCallId: e.compensatingToolCallId,
        compensationResult: e.result,
      });
    }

    if (e.type === "CompensationFailed") {
      if (e.reason === "compensation_action_failed") {
        const tracked = trackedByCallId.get(e.compensatingToolCallId);
        summary.failed.push({
          toolName: tracked?.toolName ?? "unknown",
          toolCallId: e.compensatingToolCallId,
          error: e.detail,
        });
      } else {
        const tracked = trackedByCallId.get(e.compensatingToolCallId);
        summary.uncompensatable.push({
          toolName: tracked?.toolName ?? "unknown",
          toolCallId: e.compensatingToolCallId,
          reason: e.reason,
          detail: e.detail,
        });
      }
    }
  }

  // Ambiguous: timeout_side_effect_unknown failures
  for (const [toolCallId, failed] of failedByCallId) {
    if (failed.reason === "timeout_side_effect_unknown") {
      const tracked = trackedByCallId.get(toolCallId);
      summary.ambiguous.push({
        toolName: tracked?.toolName ?? "unknown",
        toolCallId,
        reason: "timeout_side_effect_unknown",
      });
    }
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatStableArgs(stableArgs: Record<string, unknown>): string {
  const entries = Object.entries(stableArgs);
  if (entries.length === 0) return "";
  return entries
    .map(([k, v]) => `${k}=${typeof v === "string" ? `'${v}'` : String(v)}`)
    .join(", ");
}

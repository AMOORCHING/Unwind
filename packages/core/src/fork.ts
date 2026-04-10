import { randomUUID } from "node:crypto";
import type { EventStore } from "./store.js";
import type { ToolCallCompleted } from "./types.js";

export function fork(
  store: EventStore,
  parentRunId: string,
  options: { fromStep: number }
): string {
  const { fromStep } = options;

  const parentRun = store.getRun(parentRunId);
  if (!parentRun) {
    throw new Error(`Parent run "${parentRunId}" not found`);
  }

  const completedSteps = new Set(
    parentRun.events
      .filter((e): e is ToolCallCompleted => e.type === "ToolCallCompleted")
      .map((e) => e.stepIndex)
  );

  if (fromStep < 0) {
    throw new Error(`fromStep must be >= 0, got ${fromStep}`);
  }

  if (completedSteps.size === 0 && fromStep > 0) {
    throw new Error(
      `Parent run "${parentRunId}" has no completed steps to fork from`
    );
  }

  const maxCompletedStep = Math.max(...completedSteps);
  if (fromStep > maxCompletedStep + 1) {
    throw new Error(
      `fromStep ${fromStep} is out of range. Parent run has completed steps 0–${maxCompletedStep}`
    );
  }

  const newRunId = randomUUID();
  store.createRun({
    id: newRunId,
    agentId: parentRun.agentId,
    parentRunId,
    forkFromStep: fromStep,
    status: "active",
    createdAt: new Date().toISOString(),
  });

  const eventsToCopy = parentRun.events.filter(
    (e) =>
      (e.type === "ToolCallTracked" || e.type === "ToolCallCompleted") &&
      e.stepIndex < fromStep
  );

  for (const event of eventsToCopy) {
    store.appendEvent(newRunId, { ...event, eventId: randomUUID() });
  }

  return newRunId;
}

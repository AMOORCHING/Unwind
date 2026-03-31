import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SQLiteEventStore } from "./store.js";
import crypto from "node:crypto";
function uuid() {
    return crypto.randomUUID();
}
function makeRun(overrides = {}) {
    return {
        id: uuid(),
        agentId: "test-agent",
        status: "active",
        createdAt: new Date().toISOString(),
        ...overrides,
    };
}
function makeToolCallTracked(stepIndex) {
    const id = uuid();
    return {
        type: "ToolCallTracked",
        eventId: uuid(),
        stepIndex,
        timestamp: new Date().toISOString(),
        toolCallId: id,
        toolName: "send_email",
        effectClass: "reversible",
        args: { to: "alice@example.com", body: "hello" },
        stableArgs: { to: "alice@example.com" },
        idempotencyKey: `send_email:alice@example.com:${id}`,
    };
}
function makeToolCallCompleted(toolCallId, stepIndex) {
    return {
        type: "ToolCallCompleted",
        eventId: uuid(),
        stepIndex,
        timestamp: new Date().toISOString(),
        toolCallId,
        result: { messageId: "msg-123" },
        durationMs: 42,
    };
}
describe("SQLiteEventStore", () => {
    let store;
    beforeEach(() => {
        store = new SQLiteEventStore(":memory:");
    });
    afterEach(() => {
        store.close();
    });
    it("creates and retrieves a run", () => {
        const run = makeRun();
        store.createRun(run);
        const retrieved = store.getRun(run.id);
        expect(retrieved).not.toBeNull();
        expect(retrieved.id).toBe(run.id);
        expect(retrieved.agentId).toBe("test-agent");
        expect(retrieved.status).toBe("active");
        expect(retrieved.events).toEqual([]);
    });
    it("returns null for unknown run", () => {
        expect(store.getRun("nonexistent")).toBeNull();
    });
    it("appends events and retrieves them in order", () => {
        const run = makeRun();
        store.createRun(run);
        const tracked = makeToolCallTracked(0);
        const completed = makeToolCallCompleted(tracked.toolCallId, 1);
        store.appendEvent(run.id, tracked);
        store.appendEvent(run.id, completed);
        const events = store.getEvents(run.id);
        expect(events).toHaveLength(2);
        expect(events[0].type).toBe("ToolCallTracked");
        expect(events[1].type).toBe("ToolCallCompleted");
        expect(events[0].stepIndex).toBe(0);
        expect(events[1].stepIndex).toBe(1);
    });
    it("getRun includes events", () => {
        const run = makeRun();
        store.createRun(run);
        store.appendEvent(run.id, makeToolCallTracked(0));
        const retrieved = store.getRun(run.id);
        expect(retrieved.events).toHaveLength(1);
        expect(retrieved.events[0].type).toBe("ToolCallTracked");
    });
    it("lists runs filtered by status", () => {
        const active = makeRun({ status: "active" });
        const completed = makeRun({ status: "completed" });
        const failed = makeRun({ status: "failed" });
        store.createRun(active);
        store.createRun(completed);
        store.createRun(failed);
        const activeRuns = store.listRuns({ status: "active" });
        expect(activeRuns).toHaveLength(1);
        expect(activeRuns[0].id).toBe(active.id);
        const all = store.listRuns();
        expect(all).toHaveLength(3);
    });
    it("updates run status and sets completedAt for terminal states", () => {
        const run = makeRun();
        store.createRun(run);
        store.updateRunStatus(run.id, "completed");
        const retrieved = store.getRun(run.id);
        expect(retrieved.status).toBe("completed");
        expect(retrieved.completedAt).toBeDefined();
    });
    it("preserves optional fields (parentRunId, forkFromStep)", () => {
        const parentId = uuid();
        const run = makeRun({
            parentRunId: parentId,
            forkFromStep: 3,
        });
        store.createRun(run);
        const retrieved = store.getRun(run.id);
        expect(retrieved.parentRunId).toBe(parentId);
        expect(retrieved.forkFromStep).toBe(3);
    });
    it("preserves event data fidelity through JSON round-trip", () => {
        const run = makeRun();
        store.createRun(run);
        const failedEvent = {
            type: "RunFailed",
            eventId: uuid(),
            stepIndex: 0,
            timestamp: new Date().toISOString(),
            error: { code: "NETWORK_ERROR", details: [1, 2, 3] },
            message: "Connection refused",
        };
        store.appendEvent(run.id, failedEvent);
        const events = store.getEvents(run.id);
        const retrieved = events[0];
        expect(retrieved.type).toBe("RunFailed");
        expect(retrieved.message).toBe("Connection refused");
        expect(retrieved.error).toEqual({ code: "NETWORK_ERROR", details: [1, 2, 3] });
    });
    it("returns events in stepIndex order regardless of insertion order", () => {
        const run = makeRun();
        store.createRun(run);
        // Insert step 2 before step 1
        const event2 = makeToolCallTracked(2);
        const event1 = makeToolCallTracked(1);
        const event0 = makeToolCallTracked(0);
        store.appendEvent(run.id, event2);
        store.appendEvent(run.id, event0);
        store.appendEvent(run.id, event1);
        const events = store.getEvents(run.id);
        expect(events.map((e) => e.stepIndex)).toEqual([0, 1, 2]);
    });
});
//# sourceMappingURL=store.test.js.map
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { Unwind } from "./unwind.js";
import { SQLiteEventStore } from "./store.js";
describe("Unwind – compensation runner", () => {
    let unwind;
    beforeEach(() => {
        unwind = new Unwind({ store: "sqlite", dbPath: ":memory:" });
    });
    afterEach(() => {
        unwind.close();
    });
    // -----------------------------------------------------------------------
    // Helper tools
    // -----------------------------------------------------------------------
    function makeIdempotentTool(name) {
        return unwind.tool({
            name,
            effectClass: "idempotent",
            description: `Idempotent tool ${name}`,
            args: { key: { type: "string", stable: true } },
            execute: async (args) => ({ read: args.key }),
        });
    }
    function makeReversibleTool(name, compensateImpl) {
        return unwind.tool({
            name,
            effectClass: "reversible",
            description: `Reversible tool ${name}`,
            args: { id: { type: "string", stable: true } },
            execute: async (args) => ({ created: args.id }),
            compensate: compensateImpl ?? (async (_args, _result) => ({ undone: true })),
        });
    }
    function makeAppendOnlyTool(name) {
        return unwind.tool({
            name,
            effectClass: "append-only",
            description: `Append-only tool ${name}`,
            args: {
                to: { type: "string", stable: true },
                subject: { type: "string", stable: true },
            },
            execute: async (args) => ({ sent: true, to: args.to }),
        });
    }
    function makeDestructiveTool(name) {
        return unwind.tool({
            name,
            effectClass: "destructive",
            description: `Destructive tool ${name}`,
            args: { table: { type: "string", stable: true } },
            execute: async (args) => ({ dropped: args.table }),
        });
    }
    // -----------------------------------------------------------------------
    // 1. Mixed tool calls: reversible compensated, append-only uncompensatable,
    //    idempotent skipped. Final status: "compensated".
    // -----------------------------------------------------------------------
    it("compensates reversible, skips idempotent, flags append-only as uncompensatable", async () => {
        const idempotent1 = makeIdempotentTool("readConfig");
        const idempotent2 = makeIdempotentTool("readFile");
        const idempotent3 = makeIdempotentTool("lookupUser");
        const reversible = makeReversibleTool("createUser");
        const appendOnly = makeAppendOnlyTool("send_notification");
        const runId = unwind.startRun("test-agent");
        // Dispatch all tools
        await unwind.dispatch(runId, 0, idempotent1, { key: "db-config" });
        await unwind.dispatch(runId, 1, idempotent2, { key: "/etc/hosts" });
        await unwind.dispatch(runId, 2, reversible, { id: "user-42" });
        await unwind.dispatch(runId, 3, appendOnly, {
            to: "jchen@acme.com",
            subject: "Expense Approved",
        });
        await unwind.dispatch(runId, 4, idempotent3, { key: "user-42" });
        // Compensate the run
        const summary = await unwind.compensate(runId);
        // Reversible was compensated
        expect(summary.compensated).toHaveLength(1);
        expect(summary.compensated[0].toolName).toBe("createUser");
        expect(summary.compensated[0].compensationResult).toEqual({ undone: true });
        // Append-only is uncompensatable
        expect(summary.uncompensatable).toHaveLength(1);
        expect(summary.uncompensatable[0].toolName).toBe("send_notification");
        expect(summary.uncompensatable[0].reason).toBe("append_only_no_compensation");
        expect(summary.uncompensatable[0].detail).toContain("send_notification");
        expect(summary.uncompensatable[0].detail).toContain("cannot be undone");
        // No failures
        expect(summary.failed).toHaveLength(0);
        // No ambiguous
        expect(summary.ambiguous).toHaveLength(0);
        // Final status: "compensated" (append-only uncompensatability is expected)
        const run = unwind.getRun(runId);
        expect(run.status).toBe("compensated");
    });
    // -----------------------------------------------------------------------
    // 2. Reversible compensate() throws → partially_compensated
    // -----------------------------------------------------------------------
    it("marks status as partially_compensated when reversible compensate throws", async () => {
        const idempotent = makeIdempotentTool("readConfig");
        const reversible = makeReversibleTool("createUser", async () => {
            throw new Error("Compensation service unavailable");
        });
        const runId = unwind.startRun("test-agent");
        await unwind.dispatch(runId, 0, idempotent, { key: "config" });
        await unwind.dispatch(runId, 1, reversible, { id: "user-99" });
        const summary = await unwind.compensate(runId);
        // Compensation failed
        expect(summary.failed).toHaveLength(1);
        expect(summary.failed[0].toolName).toBe("createUser");
        expect(summary.failed[0].error).toBe("Compensation service unavailable");
        // No successful compensations
        expect(summary.compensated).toHaveLength(0);
        // Final status
        const run = unwind.getRun(runId);
        expect(run.status).toBe("partially_compensated");
    });
    // -----------------------------------------------------------------------
    // 3. Destructive tool completed → partially_compensated with escalation
    // -----------------------------------------------------------------------
    it("flags destructive tool as escalation, status partially_compensated", async () => {
        unwind.configure({ approvalGate: async () => true });
        const destructive = makeDestructiveTool("dropTable");
        const runId = unwind.startRun("test-agent");
        await unwind.dispatch(runId, 0, destructive, { table: "users" });
        const summary = await unwind.compensate(runId);
        // Destructive is in uncompensatable
        expect(summary.uncompensatable).toHaveLength(1);
        expect(summary.uncompensatable[0].toolName).toBe("dropTable");
        expect(summary.uncompensatable[0].reason).toBe("destructive_escalation");
        expect(summary.uncompensatable[0].detail).toContain("destructive action");
        expect(summary.uncompensatable[0].detail).toContain("human intervention");
        // Status is partially_compensated
        const run = unwind.getRun(runId);
        expect(run.status).toBe("partially_compensated");
    });
    // -----------------------------------------------------------------------
    // 4. Timed-out tool call appears as ambiguous in summary
    // -----------------------------------------------------------------------
    it("flags timeout_side_effect_unknown as ambiguous", async () => {
        const store = new SQLiteEventStore(":memory:");
        const localUnwind = new Unwind({ store: "custom", adapter: store });
        const tool = localUnwind.tool({
            name: "slowApi",
            effectClass: "reversible",
            description: "A slow API call",
            args: { endpoint: { type: "string", stable: true } },
            execute: async () => ({ ok: true }),
            compensate: async () => ({ undone: true }),
        });
        const runId = localUnwind.startRun("test-agent");
        const toolCallId = randomUUID();
        // Manually inject a ToolCallTracked event
        const trackedEvent = {
            type: "ToolCallTracked",
            eventId: randomUUID(),
            stepIndex: 0,
            timestamp: new Date().toISOString(),
            toolCallId,
            toolName: "slowApi",
            effectClass: "reversible",
            args: { endpoint: "/api/submit" },
            stableArgs: { endpoint: "/api/submit" },
            idempotencyKey: "fake-key",
        };
        store.appendEvent(runId, trackedEvent);
        // Manually inject a ToolCallFailed with timeout_side_effect_unknown
        const failedEvent = {
            type: "ToolCallFailed",
            eventId: randomUUID(),
            stepIndex: 0,
            timestamp: new Date().toISOString(),
            toolCallId,
            error: "Request timed out after 30s",
            reason: "timeout_side_effect_unknown",
        };
        store.appendEvent(runId, failedEvent);
        const summary = await localUnwind.compensate(runId);
        // Should appear as ambiguous
        expect(summary.ambiguous).toHaveLength(1);
        expect(summary.ambiguous[0].toolName).toBe("slowApi");
        expect(summary.ambiguous[0].toolCallId).toBe(toolCallId);
        expect(summary.ambiguous[0].reason).toBe("timeout_side_effect_unknown");
        // No completed tool calls, so nothing to compensate
        expect(summary.compensated).toHaveLength(0);
        expect(summary.failed).toHaveLength(0);
        // Final status: "compensated" (no completed calls needing compensation)
        const run = localUnwind.getRun(runId);
        expect(run.status).toBe("compensated");
        localUnwind.close();
    });
    // -----------------------------------------------------------------------
    // 5. getCompensationSummary returns same structure from events
    // -----------------------------------------------------------------------
    it("getCompensationSummary reconstructs summary from event log", async () => {
        const reversible = makeReversibleTool("createUser");
        const appendOnly = makeAppendOnlyTool("send_notification");
        const runId = unwind.startRun("test-agent");
        await unwind.dispatch(runId, 0, reversible, { id: "user-1" });
        await unwind.dispatch(runId, 1, appendOnly, {
            to: "test@example.com",
            subject: "Hello",
        });
        await unwind.compensate(runId);
        // Retrieve summary independently
        const summary = unwind.getCompensationSummary(runId);
        expect(summary.compensated).toHaveLength(1);
        expect(summary.compensated[0].toolName).toBe("createUser");
        expect(summary.uncompensatable).toHaveLength(1);
        expect(summary.uncompensatable[0].toolName).toBe("send_notification");
        expect(summary.failed).toHaveLength(0);
    });
    // -----------------------------------------------------------------------
    // 6. ToolCallFailed (non-timeout) should NOT be compensated
    // -----------------------------------------------------------------------
    it("does not compensate tool calls that failed during execution", async () => {
        const store = new SQLiteEventStore(":memory:");
        const localUnwind = new Unwind({ store: "custom", adapter: store });
        const tool = localUnwind.tool({
            name: "createRecord",
            effectClass: "reversible",
            description: "Create a record",
            args: { id: { type: "string", stable: true } },
            execute: async () => {
                throw new Error("DB connection failed");
            },
            compensate: async () => ({ undone: true }),
        });
        const runId = localUnwind.startRun("test-agent");
        // Tool will fail during execution
        try {
            await localUnwind.dispatch(runId, 0, tool, { id: "rec-1" });
        }
        catch {
            // expected
        }
        const summary = await localUnwind.compensate(runId);
        // Nothing to compensate — tool never completed
        expect(summary.compensated).toHaveLength(0);
        expect(summary.failed).toHaveLength(0);
        expect(summary.uncompensatable).toHaveLength(0);
        expect(summary.ambiguous).toHaveLength(0);
        localUnwind.close();
    });
});
//# sourceMappingURL=compensate.test.js.map
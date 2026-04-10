import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Unwind } from "../unwind.js";
import { toAnthropicTools } from "./anthropic.js";
describe("Anthropic adapter", () => {
    let unwind;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let readFile;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sendEmail;
    beforeEach(() => {
        unwind = new Unwind({ store: "sqlite", dbPath: ":memory:" });
        readFile = unwind.tool({
            name: "readFile",
            effectClass: "idempotent",
            description: "Read a file from disk",
            args: {
                path: { type: "string", stable: true },
            },
            execute: async (args) => ({ content: `contents of ${args.path}` }),
        });
        sendEmail = unwind.tool({
            name: "sendEmail",
            effectClass: "reversible",
            description: "Send an email to a recipient",
            args: {
                to: { type: "string", stable: true },
                subject: { type: "string", stable: true },
                body: { type: "string", stable: false },
            },
            execute: async (args) => ({ messageId: `msg-${args.to}` }),
            compensate: async () => ({ recalled: true }),
        });
    });
    afterEach(() => {
        unwind.close();
    });
    // -------------------------------------------------------------------------
    // Schema conversion
    // -------------------------------------------------------------------------
    it("converts tools to Anthropic SDK format with correct schema", () => {
        const anthropicDefs = unwind.anthropicTools([readFile, sendEmail]);
        expect(anthropicDefs).toHaveLength(2);
        expect(anthropicDefs[0]).toEqual({
            name: "readFile",
            description: "Read a file from disk",
            input_schema: {
                type: "object",
                properties: {
                    path: { type: "string" },
                },
                required: ["path"],
            },
        });
        expect(anthropicDefs[1]).toEqual({
            name: "sendEmail",
            description: "Send an email to a recipient",
            input_schema: {
                type: "object",
                properties: {
                    to: { type: "string" },
                    subject: { type: "string" },
                    body: { type: "string" },
                },
                required: ["to", "subject", "body"],
            },
        });
    });
    it("returns empty array for empty tools list", () => {
        const anthropicDefs = toAnthropicTools([]);
        expect(anthropicDefs).toEqual([]);
    });
    // -------------------------------------------------------------------------
    // handleToolUse dispatch
    // -------------------------------------------------------------------------
    it("dispatches a tool_use block and returns tool_result", async () => {
        const runId = unwind.startRun("test-agent");
        const toolUseBlock = {
            type: "tool_use",
            id: "toolu_01ABC",
            name: "readFile",
            input: { path: "/etc/hosts" },
        };
        const result = await unwind.handleToolUse(runId, 0, toolUseBlock, [readFile, sendEmail]);
        expect(result).toEqual({
            type: "tool_result",
            tool_use_id: "toolu_01ABC",
            content: JSON.stringify({ content: "contents of /etc/hosts" }),
        });
        const run = unwind.getRun(runId);
        expect(run.events).toHaveLength(2);
        const tracked = run.events[0];
        expect(tracked.type).toBe("ToolCallTracked");
        expect(tracked.toolName).toBe("readFile");
        expect(tracked.args).toEqual({ path: "/etc/hosts" });
        const completed = run.events[1];
        expect(completed.type).toBe("ToolCallCompleted");
        expect(completed.result).toEqual({ content: "contents of /etc/hosts" });
    });
    it("logs events for reversible tool dispatch", async () => {
        const runId = unwind.startRun("test-agent");
        const toolUseBlock = {
            type: "tool_use",
            id: "toolu_02DEF",
            name: "sendEmail",
            input: { to: "user@example.com", subject: "Hello", body: "World" },
        };
        const result = await unwind.handleToolUse(runId, 0, toolUseBlock, [readFile, sendEmail]);
        expect(result.type).toBe("tool_result");
        expect(result.tool_use_id).toBe("toolu_02DEF");
        const run = unwind.getRun(runId);
        const tracked = run.events[0];
        expect(tracked.effectClass).toBe("reversible");
        expect(tracked.stableArgs).toEqual({
            to: "user@example.com",
            subject: "Hello",
        });
    });
    it("throws for unknown tool name", async () => {
        const runId = unwind.startRun("test-agent");
        const toolUseBlock = {
            type: "tool_use",
            id: "toolu_03GHI",
            name: "nonexistent",
            input: {},
        };
        await expect(unwind.handleToolUse(runId, 0, toolUseBlock, [readFile])).rejects.toThrow(/Unknown tool "nonexistent"/);
    });
    // -------------------------------------------------------------------------
    // Idempotency through the adapter
    // -------------------------------------------------------------------------
    it("idempotency works through handleToolUse (same dispatch replayed)", async () => {
        let callCount = 0;
        const counter = unwind.tool({
            name: "counter",
            effectClass: "idempotent",
            description: "Increment counter",
            args: { id: { type: "string", stable: true } },
            execute: async () => {
                callCount++;
                return { count: callCount };
            },
        });
        const runId = unwind.startRun("test-agent");
        const toolUseBlock = {
            type: "tool_use",
            id: "toolu_04JKL",
            name: "counter",
            input: { id: "abc" },
        };
        const first = await unwind.handleToolUse(runId, 0, toolUseBlock, [counter]);
        const second = await unwind.handleToolUse(runId, 0, toolUseBlock, [counter]);
        expect(first.content).toBe(JSON.stringify({ count: 1 }));
        expect(second.content).toBe(JSON.stringify({ count: 1 }));
        expect(callCount).toBe(1);
    });
    // -------------------------------------------------------------------------
    // Multi-step Anthropic loop simulation
    // -------------------------------------------------------------------------
    it("supports a multi-step tool loop (two different tools)", async () => {
        const runId = unwind.startRun("test-agent");
        const step0Result = await unwind.handleToolUse(runId, 0, {
            type: "tool_use",
            id: "toolu_step0",
            name: "readFile",
            input: { path: "/app/config.json" },
        }, [readFile, sendEmail]);
        const step1Result = await unwind.handleToolUse(runId, 1, {
            type: "tool_use",
            id: "toolu_step1",
            name: "sendEmail",
            input: { to: "admin@test.com", subject: "Config", body: "See attached" },
        }, [readFile, sendEmail]);
        expect(JSON.parse(step0Result.content)).toEqual({
            content: "contents of /app/config.json",
        });
        expect(JSON.parse(step1Result.content)).toEqual({
            messageId: "msg-admin@test.com",
        });
        const run = unwind.getRun(runId);
        expect(run.events).toHaveLength(4);
        expect(run.events.map((e) => e.type)).toEqual([
            "ToolCallTracked",
            "ToolCallCompleted",
            "ToolCallTracked",
            "ToolCallCompleted",
        ]);
    });
});
//# sourceMappingURL=anthropic.test.js.map
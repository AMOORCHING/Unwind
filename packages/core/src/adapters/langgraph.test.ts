import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Unwind } from "../unwind.js";
import type { UnwindTool } from "../tool.js";
import type { ToolCallTracked, ToolCallCompleted } from "../types.js";
import { toLangGraphTool, toLangGraphTools } from "./langgraph.js";

describe("LangGraph adapter", () => {
  let unwind: Unwind;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let readFile: UnwindTool<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let createUser: UnwindTool<any>;

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

    createUser = unwind.tool({
      name: "createUser",
      effectClass: "reversible",
      description: "Create a new user account",
      args: {
        email: { type: "string", stable: true },
        name: { type: "string", stable: true },
        requestId: { type: "string", stable: false },
      },
      execute: async (args) => ({ userId: `user-${args.email}` }),
      compensate: async () => ({ deleted: true }),
    });
  });

  afterEach(() => {
    unwind.close();
  });

  // -------------------------------------------------------------------------
  // Schema conversion
  // -------------------------------------------------------------------------

  it("converts a single tool to LangGraph format", () => {
    const lgTool = toLangGraphTool(readFile, async () => ({}));

    expect(lgTool.name).toBe("readFile");
    expect(lgTool.description).toBe("Read a file from disk");
    expect(lgTool.schema).toEqual({
      type: "object",
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
    });
    expect(typeof lgTool.func).toBe("function");
  });

  it("converts multiple tools preserving all args", () => {
    const lgTools = toLangGraphTools(
      [readFile, createUser],
      async () => ({})
    );

    expect(lgTools).toHaveLength(2);

    expect(lgTools[1].name).toBe("createUser");
    expect(lgTools[1].schema).toEqual({
      type: "object",
      properties: {
        email: { type: "string" },
        name: { type: "string" },
        requestId: { type: "string" },
      },
      required: ["email", "name", "requestId"],
    });
  });

  it("returns empty array for empty tools list", () => {
    const lgTools = toLangGraphTools([], async () => ({}));
    expect(lgTools).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Dispatch through func
  // -------------------------------------------------------------------------

  it("func dispatches through Unwind and returns JSON string", async () => {
    const runId = unwind.startRun("test-agent");
    let step = 0;

    const lgTool = toLangGraphTool(readFile, async (tool, args) => {
      return unwind.dispatch(runId, step++, tool, args);
    });

    const result = await lgTool.func({ path: "/etc/hosts" });
    expect(result).toBe(JSON.stringify({ content: "contents of /etc/hosts" }));

    const run = unwind.getRun(runId);
    expect(run!.events).toHaveLength(2);

    const tracked = run!.events[0] as ToolCallTracked;
    expect(tracked.type).toBe("ToolCallTracked");
    expect(tracked.toolName).toBe("readFile");

    const completed = run!.events[1] as ToolCallCompleted;
    expect(completed.type).toBe("ToolCallCompleted");
  });

  it("func records correct stable args for reversible tools", async () => {
    const runId = unwind.startRun("test-agent");
    let step = 0;

    const lgTool = toLangGraphTool(createUser, async (tool, args) => {
      return unwind.dispatch(runId, step++, tool, args);
    });

    await lgTool.func({
      email: "alice@example.com",
      name: "Alice",
      requestId: "req-999",
    });

    const run = unwind.getRun(runId);
    const tracked = run!.events[0] as ToolCallTracked;
    expect(tracked.stableArgs).toEqual({
      email: "alice@example.com",
      name: "Alice",
    });
  });

  // -------------------------------------------------------------------------
  // Idempotency through LangGraph adapter
  // -------------------------------------------------------------------------

  it("idempotency works through toLangGraphTool dispatch", async () => {
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

    const lgTool = toLangGraphTool(counter, async (tool, args) => {
      return unwind.dispatch(runId, 0, tool, args);
    });

    const first = await lgTool.func({ id: "abc" });
    const second = await lgTool.func({ id: "abc" });

    expect(first).toBe(JSON.stringify({ count: 1 }));
    expect(second).toBe(JSON.stringify({ count: 1 }));
    expect(callCount).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Multi-tool dispatch
  // -------------------------------------------------------------------------

  it("supports dispatching multiple different tools in sequence", async () => {
    const runId = unwind.startRun("test-agent");
    let step = 0;

    const lgTools = toLangGraphTools(
      [readFile, createUser],
      async (tool, args) => unwind.dispatch(runId, step++, tool, args)
    );

    const [readTool, createTool] = lgTools;

    const r1 = await readTool.func({ path: "/config.yaml" });
    const r2 = await createTool.func({
      email: "bob@test.com",
      name: "Bob",
      requestId: "req-1",
    });

    expect(JSON.parse(r1)).toEqual({ content: "contents of /config.yaml" });
    expect(JSON.parse(r2)).toEqual({ userId: "user-bob@test.com" });

    const run = unwind.getRun(runId);
    expect(run!.events).toHaveLength(4);
    expect(run!.events.map((e) => e.type)).toEqual([
      "ToolCallTracked",
      "ToolCallCompleted",
      "ToolCallTracked",
      "ToolCallCompleted",
    ]);
  });
});

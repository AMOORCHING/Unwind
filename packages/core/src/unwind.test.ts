import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Unwind } from "./unwind.js";
import type { ToolCallTracked, ToolCallCompleted, ToolCallFailed, ApprovalRequested, ApprovalReceived } from "./types.js";

describe("Unwind – tool wrapping, dispatch & middleware", () => {
  let unwind: Unwind;

  beforeEach(() => {
    unwind = new Unwind({ store: "sqlite", dbPath: ":memory:" });
  });

  afterEach(() => {
    unwind.close();
  });

  // -----------------------------------------------------------------------
  // 1. Wrap a tool, dispatch it, verify event log
  // -----------------------------------------------------------------------
  it("dispatches a tool and records events", async () => {
    const readFile = unwind.tool({
      name: "readFile",
      effectClass: "idempotent",
      description: "Read a file from disk",
      args: {
        path: { type: "string", stable: true },
      },
      execute: async (args) => {
        return { content: `contents of ${args.path}` };
      },
    });

    const runId = unwind.startRun("test-agent");
    const result = await unwind.dispatch(runId, 0, readFile, {
      path: "/etc/hosts",
    });

    expect(result).toEqual({ content: "contents of /etc/hosts" });

    const run = unwind.getRun(runId);
    expect(run).not.toBeNull();
    expect(run!.events).toHaveLength(2);

    const tracked = run!.events[0] as ToolCallTracked;
    expect(tracked.type).toBe("ToolCallTracked");
    expect(tracked.toolName).toBe("readFile");
    expect(tracked.idempotencyKey).toMatch(/^[a-f0-9]{64}$/);

    const completed = run!.events[1] as ToolCallCompleted;
    expect(completed.type).toBe("ToolCallCompleted");
    expect(completed.result).toEqual({ content: "contents of /etc/hosts" });
    expect(completed.durationMs).toBeGreaterThanOrEqual(0);
  });

  // -----------------------------------------------------------------------
  // 2. Idempotency: second dispatch returns cached result
  // -----------------------------------------------------------------------
  it("returns cached result on duplicate idempotency key", async () => {
    let callCount = 0;
    const tool = unwind.tool({
      name: "counter",
      effectClass: "idempotent",
      description: "Increment counter",
      args: {
        id: { type: "string", stable: true },
      },
      execute: async () => {
        callCount++;
        return { count: callCount };
      },
    });

    const runId = unwind.startRun("test-agent");

    const first = await unwind.dispatch(runId, 0, tool, { id: "abc" });
    const second = await unwind.dispatch(runId, 0, tool, { id: "abc" });

    expect(first).toEqual({ count: 1 });
    expect(second).toEqual({ count: 1 }); // cached, not re-executed
    expect(callCount).toBe(1);
  });

  // -----------------------------------------------------------------------
  // 3. Reversible tool without compensate → TypeScript error (compile-time)
  //    At runtime, we verify that a properly defined reversible tool works.
  // -----------------------------------------------------------------------
  it("reversible tool requires compensate (runtime check)", () => {
    const reversibleTool = unwind.tool({
      name: "createUser",
      effectClass: "reversible",
      description: "Create a user",
      args: { email: { type: "string", stable: true } },
      execute: async () => ({ id: "user-1" }),
      compensate: async () => ({ deleted: true }),
    });

    expect(reversibleTool.compensate).toBeDefined();
    expect(reversibleTool.definition.effectClass).toBe("reversible");

    // The following would cause a TypeScript compile error:
    // unwind.tool({
    //   name: "badReversible",
    //   effectClass: "reversible",
    //   description: "Missing compensate",
    //   args: {},
    //   execute: async () => ({}),
    //   // no compensate! → TS error
    // });
  });

  // -----------------------------------------------------------------------
  // 4. Destructive tool without approval gate throws
  // -----------------------------------------------------------------------
  it("throws when dispatching destructive tool without approval gate", async () => {
    const deleteTool = unwind.tool({
      name: "dropTable",
      effectClass: "destructive",
      description: "Drop a database table",
      args: { table: { type: "string", stable: true } },
      execute: async () => ({ dropped: true }),
    });

    const runId = unwind.startRun("test-agent");

    await expect(
      unwind.dispatch(runId, 0, deleteTool, { table: "users" })
    ).rejects.toThrow(/approval gate/i);

    const run = unwind.getRun(runId);
    const failEvent = run!.events.find((e) => e.type === "ToolCallFailed") as ToolCallFailed;
    expect(failEvent).toBeDefined();
    expect(failEvent.reason).toBe("approval_denied");
  });

  // -----------------------------------------------------------------------
  // 5. Destructive tool with approval gate logs approval events
  // -----------------------------------------------------------------------
  it("logs approval events for destructive tool with gate", async () => {
    unwind.configure({
      approvalGate: async () => true,
    });

    const deleteTool = unwind.tool({
      name: "dropTable",
      effectClass: "destructive",
      description: "Drop a database table",
      args: { table: { type: "string", stable: true } },
      execute: async () => ({ dropped: true }),
    });

    const runId = unwind.startRun("test-agent");
    const result = await unwind.dispatch(runId, 0, deleteTool, {
      table: "users",
    });

    expect(result).toEqual({ dropped: true });

    const run = unwind.getRun(runId);
    const types = run!.events.map((e) => e.type);
    expect(types).toEqual([
      "ApprovalRequested",
      "ApprovalReceived",
      "ToolCallTracked",
      "ToolCallCompleted",
    ]);

    const approvalReq = run!.events[0] as ApprovalRequested;
    expect(approvalReq.toolName).toBe("dropTable");

    const approvalRec = run!.events[1] as ApprovalReceived;
    expect(approvalRec.approved).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 6. Destructive tool with denied approval
  // -----------------------------------------------------------------------
  it("throws and logs failure when approval is denied", async () => {
    unwind.configure({
      approvalGate: async () => false,
    });

    const deleteTool = unwind.tool({
      name: "dropTable",
      effectClass: "destructive",
      description: "Drop a database table",
      args: { table: { type: "string", stable: true } },
      execute: async () => ({ dropped: true }),
    });

    const runId = unwind.startRun("test-agent");

    await expect(
      unwind.dispatch(runId, 0, deleteTool, { table: "users" })
    ).rejects.toThrow(/denied/i);

    const run = unwind.getRun(runId);
    const types = run!.events.map((e) => e.type);
    expect(types).toEqual([
      "ApprovalRequested",
      "ApprovalReceived",
      "ToolCallFailed",
    ]);
  });

  // -----------------------------------------------------------------------
  // 7. Stable vs ephemeral args in idempotency
  // -----------------------------------------------------------------------
  it("only uses stable args for idempotency key", async () => {
    let callCount = 0;
    const tool = unwind.tool({
      name: "search",
      effectClass: "idempotent",
      description: "Search",
      args: {
        query: { type: "string", stable: true },
        requestId: { type: "string", stable: false }, // ephemeral
      },
      execute: async () => {
        callCount++;
        return { results: [] };
      },
    });

    const runId = unwind.startRun("test-agent");

    await unwind.dispatch(runId, 0, tool, {
      query: "hello",
      requestId: "req-1",
    });
    // Same stable args (query), different ephemeral arg (requestId)
    await unwind.dispatch(runId, 0, tool, {
      query: "hello",
      requestId: "req-2",
    });

    expect(callCount).toBe(1); // second call was cached
  });

  // -----------------------------------------------------------------------
  // 8. Execution error logs ToolCallFailed
  // -----------------------------------------------------------------------
  it("logs ToolCallFailed on execution error", async () => {
    const failTool = unwind.tool({
      name: "failingTool",
      effectClass: "idempotent",
      description: "Always fails",
      args: {},
      execute: async () => {
        throw new Error("boom");
      },
    });

    const runId = unwind.startRun("test-agent");

    await expect(
      unwind.dispatch(runId, 0, failTool, {})
    ).rejects.toThrow("boom");

    const run = unwind.getRun(runId);
    const failEvent = run!.events.find((e) => e.type === "ToolCallFailed") as ToolCallFailed;
    expect(failEvent).toBeDefined();
    expect(failEvent.reason).toBe("execution_error");
    expect(failEvent.error).toBe("boom");
  });
});

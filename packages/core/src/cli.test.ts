import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Unwind } from "./unwind.js";
import { SQLiteEventStore } from "./store.js";
import {
  listRuns,
  inspectRun,
  compensateRun,
  forkRun,
  formatCompensationSummary,
} from "./cli.js";
import { MockStripe, MockEmail, MockDB } from "./demo/mocks.js";
import { createDemoTools } from "./demo/tools.js";

describe("CLI – list, inspect, compensate, fork, summary", () => {
  let store: SQLiteEventStore;
  let unwind: Unwind;
  let mocks: { stripe: MockStripe; email: MockEmail; db: MockDB };
  let tools: ReturnType<typeof createDemoTools>;

  beforeEach(() => {
    store = new SQLiteEventStore(":memory:");
    unwind = new Unwind({ store: "custom", adapter: store });
    unwind.configure({ approvalGate: async () => true });

    mocks = {
      stripe: new MockStripe(),
      email: new MockEmail(),
      db: new MockDB(),
    };
    tools = createDemoTools(unwind, mocks);
  });

  afterEach(() => {
    unwind.close();
  });

  // -------------------------------------------------------------------------
  // Scenario: Happy path — expense approval flow
  // -------------------------------------------------------------------------
  async function runHappyPath(): Promise<string> {
    const runId = unwind.startRun("expense-agent");

    await unwind.dispatch(runId, 0, tools.checkBalance, {
      account_id: "jchen@acme.com",
    });
    await unwind.dispatch(runId, 1, tools.classifyExpense, {
      description: "Team dinner at Nobu",
    });
    await unwind.dispatch(runId, 2, tools.chargeCard, {
      amount: 28500,
      source: "card_jchen",
      description: "Team dinner at Nobu",
    });
    await unwind.dispatch(runId, 3, tools.sendNotification, {
      to: "jchen@acme.com",
      subject: "Expense Approved",
      body: "Your expense for Team dinner at Nobu ($285.00) has been approved.",
    });

    return runId;
  }

  // -------------------------------------------------------------------------
  // Scenario: Compensation path — charge succeeds, notification fails,
  // then we compensate
  // -------------------------------------------------------------------------
  async function runCompensationScenario(): Promise<string> {
    const runId = unwind.startRun("expense-agent");

    await unwind.dispatch(runId, 0, tools.checkBalance, {
      account_id: "jchen@acme.com",
    });
    await unwind.dispatch(runId, 1, tools.chargeCard, {
      amount: 15000,
      source: "card_jchen",
      description: "Client lunch",
    });
    await unwind.dispatch(runId, 2, tools.sendNotification, {
      to: "jchen@acme.com",
      subject: "Expense Approved",
      body: "Your expense for Client lunch ($150.00) has been approved.",
    });

    await unwind.compensate(runId);
    return runId;
  }

  // -------------------------------------------------------------------------
  // list command
  // -------------------------------------------------------------------------
  describe("list", () => {
    it("shows 'No runs found.' for empty store", () => {
      const output = listRuns(store);
      expect(output).toBe("No runs found.");
    });

    it("lists all runs with correct columns", async () => {
      await runHappyPath();
      await runCompensationScenario();

      const output = listRuns(store);
      const lines = output.split("\n");

      expect(lines[0]).toContain("Run ID");
      expect(lines[0]).toContain("Agent ID");
      expect(lines[0]).toContain("Status");
      expect(lines[0]).toContain("Tool Calls");
      expect(lines[0]).toContain("Compensations");
      expect(lines[0]).toContain("Created");

      // 2 data rows (header + separator + 2 rows = 4 lines)
      expect(lines.length).toBe(4);
    });

    it("filters by status", async () => {
      await runHappyPath();
      await runCompensationScenario();

      const compensatedOutput = listRuns(store, "compensated");
      const compensatedLines = compensatedOutput.split("\n");
      // header + separator + 1 row
      expect(compensatedLines.length).toBe(3);

      const activeOutput = listRuns(store, "active");
      const activeLines = activeOutput.split("\n");
      // header + separator + 1 row
      expect(activeLines.length).toBe(3);
    });

    it("shows tool call and compensation counts", async () => {
      await runCompensationScenario();

      const output = listRuns(store);
      const dataLine = output.split("\n")[2];

      // 3 tool calls: checkBalance, chargeCard, sendNotification
      expect(dataLine).toContain("3");
      expect(dataLine).toContain("compensated");
    });
  });

  // -------------------------------------------------------------------------
  // inspect command
  // -------------------------------------------------------------------------
  describe("inspect", () => {
    it("returns not found for unknown run", () => {
      const output = inspectRun(store, "nonexistent-id");
      expect(output).toContain("not found");
    });

    it("prints step-by-step timeline for happy path", async () => {
      const runId = await runHappyPath();
      const output = inspectRun(store, runId);

      expect(output).toContain(`Run: ${runId}`);
      expect(output).toContain("expense-agent");
      expect(output).toContain("check_balance");
      expect(output).toContain("[idempotent]");
      expect(output).toContain("classify_expense");
      expect(output).toContain("charge_card");
      expect(output).toContain("[reversible]");
      expect(output).toContain("send_notification");
      expect(output).toContain("[append-only]");

      // Step indices present
      expect(output).toContain("step 0");
      expect(output).toContain("step 1");
      expect(output).toContain("step 2");
      expect(output).toContain("step 3");

      // Results are shown (truncated)
      expect(output).toContain("balance");
      expect(output).toContain("ch_");
    });

    it("shows compensation sub-entries after compensate", async () => {
      const runId = await runCompensationScenario();
      const output = inspectRun(store, runId);

      expect(output).toContain("↩ compensating");
      expect(output).toContain("↩ compensated");
      expect(output).toContain("↩ compensation failed");

      expect(output).toContain("Compensation Summary:");
      expect(output).toContain("Compensated:");
      expect(output).toContain("charge_card");
      expect(output).toContain("Uncompensatable:");
      expect(output).toContain("send_notification");
    });

    it("shows approval events for destructive tools", async () => {
      const runId = unwind.startRun("admin-agent");
      await unwind.dispatch(runId, 0, tools.deleteAccount, {
        account_id: "jchen@acme.com",
        reason: "Account closure requested",
      });

      const output = inspectRun(store, runId);
      expect(output).toContain("approval requested");
      expect(output).toContain("delete_account");
      expect(output).toContain("approved");
      expect(output).toContain("[DESTRUCTIVE]");
    });

    it("shows fork metadata", async () => {
      const parentId = await runHappyPath();
      const forkOutput = forkRun(store, parentId, 2);
      const newRunId = forkOutput.split("\n")[0].replace("Forked run: ", "");

      const output = inspectRun(store, newRunId);
      expect(output).toContain("Forked from:");
      expect(output).toContain(parentId);
    });
  });

  // -------------------------------------------------------------------------
  // compensate command
  // -------------------------------------------------------------------------
  describe("compensate", () => {
    it("returns not found for unknown run", () => {
      const output = compensateRun(store, "nonexistent-id");
      expect(output).toContain("not found");
    });

    it("shows compensation summary and final status", async () => {
      const runId = await runCompensationScenario();
      const output = compensateRun(store, runId);

      expect(output).toContain("Compensation Summary:");
      expect(output).toContain("Compensated:");
      expect(output).toContain("charge_card");
      expect(output).toContain("Uncompensatable:");
      expect(output).toContain("send_notification");
      expect(output).toContain("Final status: compensated");
    });

    it("shows partially_compensated with destructive tools", async () => {
      const runId = unwind.startRun("admin-agent");
      await unwind.dispatch(runId, 0, tools.chargeCard, {
        amount: 5000,
        source: "card_admin",
        description: "Test charge",
      });
      await unwind.dispatch(runId, 1, tools.deleteAccount, {
        account_id: "test@acme.com",
        reason: "cleanup",
      });

      await unwind.compensate(runId);
      const output = compensateRun(store, runId);

      expect(output).toContain("Final status: partially_compensated");
      expect(output).toContain("Uncompensatable:");
      expect(output).toContain("destructive");
    });
  });

  // -------------------------------------------------------------------------
  // fork command
  // -------------------------------------------------------------------------
  describe("fork", () => {
    it("creates a forked run and reports replayed steps", async () => {
      const parentId = await runHappyPath();
      const output = forkRun(store, parentId, 2);

      expect(output).toContain("Forked run:");
      expect(output).toContain(`Parent: ${parentId}`);
      expect(output).toContain("Replayed steps: 0, 1");
      expect(output).toContain("Live execution resumes from step 2");

      // Verify the new run actually exists
      const newRunId = output.split("\n")[0].replace("Forked run: ", "");
      const run = store.getRun(newRunId);
      expect(run).not.toBeNull();
      expect(run!.parentRunId).toBe(parentId);
      expect(run!.forkFromStep).toBe(2);
    });

    it("fork from step 0 replays nothing", async () => {
      const parentId = await runHappyPath();
      const output = forkRun(store, parentId, 0);

      expect(output).toContain("Replayed steps: (none)");
      expect(output).toContain("Live execution resumes from step 0");
    });

    it("throws for invalid parent run", () => {
      expect(() => forkRun(store, "nonexistent", 0)).toThrow(/not found/);
    });
  });

  // -------------------------------------------------------------------------
  // summary command
  // -------------------------------------------------------------------------
  describe("summary", () => {
    it("formats compensation summary with all categories", async () => {
      const runId = await runCompensationScenario();
      const summary = unwind.getCompensationSummary(runId);
      const output = formatCompensationSummary(summary);

      expect(output).toContain("Compensation Summary:");
      expect(output).toContain("Compensated:");
      expect(output).toContain("charge_card");
      expect(output).toContain("Uncompensatable:");
      expect(output).toContain("send_notification");
      expect(output).toContain("cannot be undone");
      expect(output).toContain("Failed: (none)");
    });

    it("shows (none) when no compensations exist", async () => {
      const runId = await runHappyPath();
      const summary = unwind.getCompensationSummary(runId);
      const output = formatCompensationSummary(summary);

      expect(output).toContain("Compensated: (none)");
      expect(output).toContain("Uncompensatable: (none)");
      expect(output).toContain("Failed: (none)");
    });

    it("shows failed compensations", async () => {
      const failUnwind = new Unwind({ store: "custom", adapter: store });
      const failingReversible = failUnwind.tool({
        name: "failingReversible",
        effectClass: "reversible",
        description: "Tool whose compensation fails",
        args: { id: { type: "string", stable: true } },
        execute: async (args) => ({ created: args.id }),
        compensate: async () => {
          throw new Error("Compensation service down");
        },
      });

      const runId = failUnwind.startRun("test-agent");
      await failUnwind.dispatch(runId, 0, failingReversible, { id: "rec-1" });
      const summary = await failUnwind.compensate(runId);
      const output = formatCompensationSummary(summary);

      expect(output).toContain("Failed:");
      expect(output).toContain("failingReversible");
      expect(output).toContain("Compensation service down");

      failUnwind.close();
    });
  });

  // -------------------------------------------------------------------------
  // End-to-end: full expense flow → failure → compensate → fork → inspect
  // -------------------------------------------------------------------------
  describe("end-to-end scenario", () => {
    it("runs happy path, compensates, forks, and all CLI views are consistent", async () => {
      // 1. Run a successful expense approval
      const runId = await runHappyPath();
      const listOutput1 = listRuns(store);
      expect(listOutput1).toContain("active");
      expect(listOutput1).toContain("expense-agent");

      // 2. Inspect the run
      const inspectOutput1 = inspectRun(store, runId);
      expect(inspectOutput1).toContain("step 0");
      expect(inspectOutput1).toContain("step 3");
      expect(inspectOutput1).not.toContain("Compensation Summary:");

      // 3. Compensate the run
      await unwind.compensate(runId);
      const compOutput = compensateRun(store, runId);
      expect(compOutput).toContain("charge_card");
      expect(compOutput).toContain("Final status: compensated");

      // 4. Verify inspect now shows compensation entries
      const inspectOutput2 = inspectRun(store, runId);
      expect(inspectOutput2).toContain("↩ compensating");
      expect(inspectOutput2).toContain("Compensation Summary:");

      // 5. Fork from step 2
      const forkOutput = forkRun(store, runId, 2);
      expect(forkOutput).toContain("Replayed steps: 0, 1");
      const forkedRunId = forkOutput.split("\n")[0].replace("Forked run: ", "");

      // 6. List should now show both runs
      const listOutput2 = listRuns(store);
      const dataLines = listOutput2.split("\n").slice(2);
      expect(dataLines.length).toBe(2);

      // 7. Inspect the forked run
      const inspectFork = inspectRun(store, forkedRunId);
      expect(inspectFork).toContain("Forked from:");
      expect(inspectFork).toContain(runId);
    });
  });
});

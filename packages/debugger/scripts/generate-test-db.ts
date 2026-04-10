/**
 * Generates a test unwind.db by running the demo scenarios from the core package.
 * Run with: npx tsx scripts/generate-test-db.ts
 */
import { randomUUID } from "node:crypto";
import { Unwind } from "../../core/src/unwind.js";
import { MockStripe, MockEmail, MockDB } from "../../core/src/demo/mocks.js";
import { createDemoTools } from "../../core/src/demo/tools.js";
import type { UnwindTool } from "../../core/src/tool.js";
import fs from "node:fs";
import path from "node:path";

const DB_PATH = path.join(import.meta.dirname, "..", "test-unwind.db");

if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

function setup(dbPath: string) {
  const unwind = new Unwind({ store: "sqlite", dbPath });
  const stripe = new MockStripe();
  const email = new MockEmail();
  const db = new MockDB();
  const tools = createDemoTools(unwind, { stripe, email, db });
  const allTools: UnwindTool[] = [
    tools.checkBalance,
    tools.classifyExpense,
    tools.chargeCard,
    tools.sendNotification,
    tools.deleteAccount,
  ];
  return { unwind, stripe, email, db, tools, allTools };
}

interface LLMResponse {
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  >;
  stop_reason: "end_turn" | "tool_use";
}

let toolCallSeq = 0;
function mockId(): string {
  return `toolu_mock_${String(++toolCallSeq).padStart(3, "0")}`;
}

function toolUse(name: string, input: Record<string, unknown>): LLMResponse {
  return { stop_reason: "tool_use", content: [{ type: "tool_use", id: mockId(), name, input }] };
}

function endTurn(text: string): LLMResponse {
  return { stop_reason: "end_turn", content: [{ type: "text", text }] };
}

function expenseCalls(): LLMResponse[] {
  return [
    toolUse("check_balance", { account_id: "jchen@acme.com" }),
    toolUse("classify_expense", { description: "$340 team dinner" }),
    toolUse("charge_card", {
      amount: 34000,
      source: "jchen@acme.com",
      description: "Expense #4521: $340 team dinner",
    }),
    toolUse("send_notification", {
      to: "jchen@acme.com",
      subject: "Expense #4521 Processed",
      body: "Your expense report #4521 for $340.00 (team dinner) has been processed.",
    }),
  ];
}

async function agentLoop(cfg: {
  unwind: Unwind;
  runId: string;
  tools: UnwindTool[];
  responses: LLMResponse[];
  forkFromStep?: number;
  beforeStep?: (step: number) => void;
}): Promise<{ steps: number; error: Error | null }> {
  let step = 0;
  let error: Error | null = null;
  let respIdx = 0;

  while (respIdx < cfg.responses.length) {
    const resp = cfg.responses[respIdx++];
    const uses = resp.content.filter((b) => b.type === "tool_use");

    if (resp.stop_reason === "end_turn" || uses.length === 0) break;

    for (const block of uses) {
      if (block.type !== "tool_use") continue;
      cfg.beforeStep?.(step);
      try {
        await cfg.unwind.handleToolUse(
          cfg.runId,
          step,
          block as { type: "tool_use"; id: string; name: string; input: Record<string, unknown> },
          cfg.tools,
        );
        step++;
      } catch (err) {
        error = err as Error;
        step++;
        break;
      }
    }
    if (error) break;
  }

  return { steps: step, error };
}

async function main() {
  console.log("Generating test database at:", DB_PATH);

  // Scenario 1: Happy path (completed)
  {
    const { unwind, allTools } = setup(DB_PATH);
    const runId = unwind.startRun("expense-agent");
    const responses = [
      ...expenseCalls(),
      endTurn("Expense processed successfully."),
    ];
    await agentLoop({ unwind, runId, tools: allTools, responses });
    // Mark completed
    const run = unwind.getRun(runId)!;
    if (run.status === "active") {
      (unwind as any)["eventStore"].updateRunStatus(runId, "completed");
      (unwind as any)["eventStore"].appendEvent(runId, {
        type: "RunCompleted",
        eventId: randomUUID(),
        stepIndex: 4,
        timestamp: new Date().toISOString(),
      });
    }
    console.log("  Scenario 1 (happy path):", runId.slice(0, 8));
    unwind.close();
  }

  // Scenario 2: Failure + compensation
  {
    const { unwind, email, allTools } = setup(DB_PATH);
    email.failOnNextCall({ type: "error" });
    const runId = unwind.startRun("expense-agent");
    const responses = expenseCalls();
    const result = await agentLoop({ unwind, runId, tools: allTools, responses });
    if (result.error) {
      (unwind as any)["eventStore"].updateRunStatus(runId, "failed");
      (unwind as any)["eventStore"].appendEvent(runId, {
        type: "RunFailed",
        eventId: randomUUID(),
        stepIndex: result.steps - 1,
        timestamp: new Date().toISOString(),
        error: result.error.message,
        message: result.error.message,
      });
    }
    // Run compensation
    const summary = await unwind.compensate(runId);
    console.log("  Scenario 2 (failure+comp):", runId.slice(0, 8), "compensated:", summary.compensated.length, "uncomp:", summary.uncompensatable.length);
    unwind.close();
  }

  // Scenario 3: Partial compensation
  {
    const { unwind, stripe, allTools } = setup(DB_PATH);
    const runId = unwind.startRun("expense-agent");
    const responses = [
      ...expenseCalls(),
      toolUse("charge_card", {
        amount: 1500,
        source: "jchen@acme.com",
        description: "Processing fee for #4521",
      }),
    ];
    const result = await agentLoop({
      unwind,
      runId,
      tools: allTools,
      responses,
      beforeStep: (step) => {
        if (step === 4) stripe.failOnNextCall({ type: "error" });
      },
    });
    if (result.error) {
      (unwind as any)["eventStore"].updateRunStatus(runId, "failed");
      (unwind as any)["eventStore"].appendEvent(runId, {
        type: "RunFailed",
        eventId: randomUUID(),
        stepIndex: result.steps - 1,
        timestamp: new Date().toISOString(),
        error: result.error.message,
        message: result.error.message,
      });
    }
    const summary = await unwind.compensate(runId);
    console.log("  Scenario 3 (partial):", runId.slice(0, 8), "compensated:", summary.compensated.length, "uncomp:", summary.uncompensatable.length);
    unwind.close();
  }

  // Scenario 4: Fork from checkpoint
  {
    const { unwind, email, allTools } = setup(DB_PATH);
    // Base run (email fails)
    email.failOnNextCall({ type: "error" });
    const baseRunId = unwind.startRun("expense-agent");
    const baseResponses = expenseCalls();
    const baseResult = await agentLoop({ unwind, runId: baseRunId, tools: allTools, responses: baseResponses });
    if (baseResult.error) {
      (unwind as any)["eventStore"].updateRunStatus(baseRunId, "failed");
    }

    // Fork from step 2
    const forkedRunId = unwind.fork(baseRunId, { fromStep: 2 });
    const forkResponses = [
      ...expenseCalls(),
      endTurn("Expense reprocessed successfully."),
    ];
    await agentLoop({
      unwind,
      runId: forkedRunId,
      tools: allTools,
      responses: forkResponses,
      forkFromStep: 2,
    });
    (unwind as any)["eventStore"].updateRunStatus(forkedRunId, "completed");
    (unwind as any)["eventStore"].appendEvent(forkedRunId, {
      type: "RunCompleted",
      eventId: randomUUID(),
      stepIndex: 4,
      timestamp: new Date().toISOString(),
    });
    console.log("  Scenario 4 (fork):", "base:", baseRunId.slice(0, 8), "fork:", forkedRunId.slice(0, 8));
    unwind.close();
  }

  // Scenario 5: Destructive + approval
  {
    const { unwind, tools, allTools } = setup(DB_PATH);
    unwind.configure({
      approvalGate: async () => true,
    });
    const runId = unwind.startRun("account-agent");
    const responses = [
      toolUse("delete_account", {
        account_id: "jchen@acme.com",
        reason: "Employee termination",
      }),
      endTurn("Account deleted."),
    ];
    await agentLoop({ unwind, runId, tools: allTools, responses });
    (unwind as any)["eventStore"].updateRunStatus(runId, "completed");
    (unwind as any)["eventStore"].appendEvent(runId, {
      type: "RunCompleted",
      eventId: randomUUID(),
      stepIndex: 1,
      timestamp: new Date().toISOString(),
    });
    console.log("  Scenario 5 (destructive):", runId.slice(0, 8));
    unwind.close();
  }

  console.log("\nDone. Test DB at:", DB_PATH);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});

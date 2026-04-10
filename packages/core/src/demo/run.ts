import { Unwind } from "../unwind.js";
import type { UnwindTool } from "../tool.js";
import type { AnthropicToolUseBlock } from "../adapters/anthropic.js";
import type { CompensationSummary } from "../compensate.js";
import type { UnwindEvent } from "../types.js";
import { MockStripe, MockEmail, MockDB } from "./mocks.js";
import { createDemoTools } from "./tools.js";

// ---------------------------------------------------------------------------
// LLM abstraction — shared by mock + real Anthropic modes
// ---------------------------------------------------------------------------

interface LLMResponse {
  content: Array<
    | { type: "text"; text: string }
    | {
        type: "tool_use";
        id: string;
        name: string;
        input: Record<string, unknown>;
      }
  >;
  stop_reason: "end_turn" | "tool_use";
}

type LLMClient = (
  messages: Array<Record<string, unknown>>,
) => Promise<LLMResponse>;

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";

// ---------------------------------------------------------------------------
// Mock LLM — scripted tool-call sequences for each scenario
// ---------------------------------------------------------------------------

let toolCallSeq = 0;
function mockId(): string {
  return `toolu_mock_${String(++toolCallSeq).padStart(3, "0")}`;
}

function toolUse(
  name: string,
  input: Record<string, unknown>,
): LLMResponse {
  return {
    stop_reason: "tool_use",
    content: [{ type: "tool_use", id: mockId(), name, input }],
  };
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
      body: "Your expense report #4521 for $340.00 (team dinner) has been processed and charged to your corporate card.",
    }),
  ];
}

function getScript(id: string): LLMResponse[] {
  switch (id) {
    case "happy_path":
      return [
        ...expenseCalls(),
        endTurn(
          "I've processed expense report #4521. The $340 team dinner submitted by jchen@acme.com has been classified as meals & entertainment (low risk), charged to their corporate card, and a confirmation email has been sent.",
        ),
      ];

    case "failure_compensation":
      return expenseCalls(); // 4th call will fail via mockEmail

    case "partial_compensation":
      return [
        ...expenseCalls(),
        toolUse("charge_card", {
          amount: 1500,
          source: "jchen@acme.com",
          description: "Processing fee for #4521",
        }),
        // 5th call will fail via mockStripe.failOnNextCall
      ];

    case "fork_retry":
      return [
        ...expenseCalls(),
        endTurn(
          "Expense report #4521 reprocessed successfully via fork. All charges applied and notification sent.",
        ),
      ];

    case "destructive_approval":
      return [
        toolUse("delete_account", {
          account_id: "jchen@acme.com",
          reason: "Employee termination",
        }),
        endTurn(
          "Account jchen@acme.com has been permanently deleted as requested.",
        ),
      ];

    default:
      throw new Error(`Unknown mock script: ${id}`);
  }
}

function createMockClient(scenarioId: string): LLMClient {
  const responses = getScript(scenarioId);
  let idx = 0;
  return async () => {
    if (idx >= responses.length) {
      throw new Error(
        `Mock LLM: exhausted scripted responses for "${scenarioId}"`,
      );
    }
    return responses[idx++];
  };
}

// ---------------------------------------------------------------------------
// Real Anthropic client (dynamic import — SDK only needed when API key set)
// ---------------------------------------------------------------------------

const EXPENSE_SYSTEM = `You are an automated expense processing agent for Acme Corp.
When given an expense report, process it step by step:
1. Check the submitter's account balance with check_balance (account_id = submitter email)
2. Classify the expense with classify_expense (description = expense text)
3. Charge the corporate card with charge_card (amount in cents, source = email, description = details)
4. Send a confirmation with send_notification (to = email, subject + body about the result)
Always complete all 4 steps in order. Express dollar amounts in cents ($340 = 34000). Be concise.`;

const DELETE_SYSTEM = `You are an account management agent for Acme Corp. When asked to delete an account, immediately call delete_account with the account_id (email) and the stated reason. Be concise.`;

async function createAnthropicClient(
  apiKey: string,
  system: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: UnwindTool<any>[],
  unwind: Unwind,
): Promise<LLMClient> {
  const mod = await import("@anthropic-ai/sdk");
  const Anthropic = mod.default;
  const client = new Anthropic({ apiKey });
  const toolDefs = unwind.anthropicTools(tools);

  return async (messages) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp = await (client as any).messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system,
      tools: toolDefs,
      messages,
    });
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      content: resp.content.map((b: any) => {
        if (b.type === "text")
          return { type: "text" as const, text: b.text };
        return {
          type: "tool_use" as const,
          id: b.id,
          name: b.name,
          input: b.input as Record<string, unknown>,
        };
      }),
      stop_reason: resp.stop_reason as "end_turn" | "tool_use",
    };
  };
}

// ---------------------------------------------------------------------------
// Agent loop
// ---------------------------------------------------------------------------

interface LoopResult {
  steps: number;
  text: string;
  error: Error | null;
}

async function agentLoop(cfg: {
  unwind: Unwind;
  runId: string;
  prompt: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: UnwindTool<any>[];
  llm: LLMClient;
  forkFromStep?: number;
  beforeStep?: (step: number) => void;
}): Promise<LoopResult> {
  let step = 0;
  const messages: Record<string, unknown>[] = [
    { role: "user", content: cfg.prompt },
  ];
  let text = "";
  let error: Error | null = null;

  while (true) {
    const resp = await cfg.llm(messages);
    const uses = resp.content.filter((b) => b.type === "tool_use");

    if (resp.stop_reason === "end_turn" || uses.length === 0) {
      text = resp.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      break;
    }

    messages.push({ role: "assistant", content: resp.content });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results: any[] = [];

    for (const block of uses) {
      if (block.type !== "tool_use") continue;

      const replayed =
        cfg.forkFromStep !== undefined && step < cfg.forkFromStep;
      cfg.beforeStep?.(step);

      const tool = cfg.tools.find((t) => t.definition.name === block.name);
      const ec = tool?.definition.effectClass ?? "unknown";

      try {
        const res = await cfg.unwind.handleToolUse(
          cfg.runId,
          step,
          block as AnthropicToolUseBlock,
          cfg.tools,
        );
        results.push(res);
        logStep(
          step,
          block.name,
          ec,
          (block as { input: Record<string, unknown> }).input,
          JSON.parse(res.content),
          replayed,
        );
        step++;
      } catch (err) {
        error = err as Error;
        logStepError(
          step,
          block.name,
          ec,
          (block as { input: Record<string, unknown> }).input,
          error,
        );
        step++;
        break;
      }
    }

    if (error) break;
    messages.push({ role: "user", content: results });
  }

  return { steps: step, text, error };
}

// ---------------------------------------------------------------------------
// Print helpers
// ---------------------------------------------------------------------------

function logHeader(title: string): void {
  const bar = "\u2501".repeat(70);
  console.log(`\n${BOLD}${bar}${RESET}`);
  console.log(`${BOLD}  ${title}${RESET}`);
  console.log(`${BOLD}${bar}${RESET}\n`);
}

function effectBadge(ec: string): string {
  const c: Record<string, string> = {
    idempotent: GREEN,
    reversible: CYAN,
    "append-only": YELLOW,
    destructive: RED,
  };
  return `${c[ec] ?? DIM}[${ec}]${RESET}`;
}

function fmtVal(v: unknown, max = 100): string {
  const s = JSON.stringify(v);
  return s.length <= max ? s : s.slice(0, max - 3) + "...";
}

function logStep(
  step: number,
  name: string,
  ec: string,
  args: Record<string, unknown>,
  result: unknown,
  replayed = false,
): void {
  const tag = replayed ? ` ${DIM}(replayed)${RESET}` : "";
  console.log(
    `  ${BOLD}Step ${step}${RESET}  ${CYAN}${name}${RESET} ${effectBadge(ec)}${tag}  ${GREEN}\u2713${RESET}`,
  );
  console.log(`  ${DIM}       args:   ${fmtVal(args)}${RESET}`);
  console.log(`  ${DIM}       result: ${fmtVal(result)}${RESET}`);
  console.log();
}

function logStepError(
  step: number,
  name: string,
  ec: string,
  args: Record<string, unknown>,
  err: Error,
): void {
  console.log(
    `  ${BOLD}Step ${step}${RESET}  ${CYAN}${name}${RESET} ${effectBadge(ec)}  ${RED}\u2717 FAILED${RESET}`,
  );
  console.log(`  ${DIM}       args:  ${fmtVal(args)}${RESET}`);
  console.log(`  ${RED}       error: ${err.message}${RESET}`);
  console.log();
}

function logCompensation(summary: CompensationSummary): void {
  console.log(`  ${BOLD}\u2500\u2500 Compensation Summary \u2500\u2500${RESET}`);
  console.log();

  if (summary.compensated.length > 0) {
    for (const c of summary.compensated) {
      console.log(
        `  ${GREEN}  \u2713 ${c.toolName}${RESET} \u2192 reversed ${DIM}${fmtVal(c.compensationResult)}${RESET}`,
      );
    }
  }

  if (summary.uncompensatable.length > 0) {
    for (const u of summary.uncompensatable) {
      console.log(
        `  ${YELLOW}  ~ ${u.toolName}${RESET} \u2192 ${u.detail}`,
      );
    }
  }

  if (summary.failed.length > 0) {
    for (const f of summary.failed) {
      console.log(
        `  ${RED}  \u2717 ${f.toolName}${RESET} \u2192 compensation failed: ${f.error}`,
      );
    }
  }

  if (summary.ambiguous.length > 0) {
    for (const a of summary.ambiguous) {
      console.log(
        `  ${MAGENTA}  ? ${a.toolName}${RESET} \u2192 ${a.reason}`,
      );
    }
  }

  console.log();
}

function statusColor(s: string): string {
  if (s === "active" || s === "completed" || s === "compensated")
    return GREEN;
  if (s === "failed") return RED;
  if (s === "partially_compensated") return YELLOW;
  return MAGENTA;
}

function logRunStatus(unwind: Unwind, runId: string): void {
  const run = unwind.getRun(runId);
  if (!run) return;

  const completed = run.events.filter(
    (e) => e.type === "ToolCallCompleted",
  ).length;
  const failed = run.events.filter(
    (e) => e.type === "ToolCallFailed",
  ).length;

  console.log(`  ${DIM}\u2500\u2500 Run Status \u2500\u2500${RESET}`);
  console.log(`  ${DIM}  Run:    ${run.id.slice(0, 8)}...${RESET}`);
  console.log(
    `  ${DIM}  Status: ${RESET}${statusColor(run.status)}${run.status}${RESET}`,
  );
  console.log(
    `  ${DIM}  Steps:  ${completed} completed, ${failed} failed${RESET}`,
  );
  console.log(`  ${DIM}  Events: ${run.events.length}${RESET}`);
  console.log();
}

function logEvents(unwind: Unwind, runId: string): void {
  const run = unwind.getRun(runId);
  if (!run) return;

  console.log(`  ${DIM}\u2500\u2500 Event Log \u2500\u2500${RESET}`);
  for (const e of run.events) {
    const t = e.type.padEnd(22);
    console.log(`  ${DIM}  ${fmtEvent(t, e)}${RESET}`);
  }
  console.log();
}

function fmtEvent(label: string, e: UnwindEvent): string {
  switch (e.type) {
    case "ToolCallTracked":
      return `${label} ${CYAN}${e.toolName}${RESET}${DIM} [${e.effectClass}]`;
    case "ToolCallCompleted":
      return `${label} result: ${fmtVal(e.result, 60)}`;
    case "ToolCallFailed":
      return `${RED}${label} ${e.reason}: ${fmtVal(e.error, 50)}${RESET}${DIM}`;
    case "ApprovalRequested":
      return `${MAGENTA}${label} ${e.toolName}(${fmtVal(e.args, 50)})${RESET}${DIM}`;
    case "ApprovalReceived":
      return `${e.approved ? GREEN : RED}${label} approved: ${e.approved}${RESET}${DIM}`;
    case "CompensationStarted":
      return `${CYAN}${label} ${e.compensationAction}${RESET}${DIM}`;
    case "CompensationCompleted":
      return `${GREEN}${label} result: ${fmtVal(e.result, 60)}${RESET}${DIM}`;
    case "CompensationFailed":
      return `${YELLOW}${label} ${e.reason}${RESET}${DIM}`;
    default:
      return label;
  }
}

// ---------------------------------------------------------------------------
// Setup factory
// ---------------------------------------------------------------------------

function setup() {
  const unwind = new Unwind({ store: "sqlite", dbPath: ":memory:" });
  const stripe = new MockStripe();
  const email = new MockEmail();
  const db = new MockDB();
  const tools = createDemoTools(unwind, { stripe, email, db });
  const allTools = [
    tools.checkBalance,
    tools.classifyExpense,
    tools.chargeCard,
    tools.sendNotification,
    tools.deleteAccount,
  ];
  return { unwind, stripe, email, db, tools, allTools };
}

const EXPENSE_PROMPT =
  "Process expense report #4521: $340 team dinner, submitted by jchen@acme.com";

// ---------------------------------------------------------------------------
// Scenario 1 — Happy Path
// ---------------------------------------------------------------------------

async function scenario1(useMock: boolean, apiKey?: string): Promise<void> {
  logHeader("Scenario 1: Happy Path");
  console.log(`  ${DIM}Prompt: "${EXPENSE_PROMPT}"${RESET}\n`);

  const { unwind, allTools } = setup();
  const runId = unwind.startRun("expense-agent");

  const llm = useMock
    ? createMockClient("happy_path")
    : await createAnthropicClient(apiKey!, EXPENSE_SYSTEM, allTools, unwind);

  const result = await agentLoop({
    unwind,
    runId,
    prompt: EXPENSE_PROMPT,
    tools: allTools,
    llm,
  });

  if (result.text) {
    console.log(`  ${BOLD}Agent:${RESET} "${result.text}"\n`);
  }

  logRunStatus(unwind, runId);
  unwind.close();
}

// ---------------------------------------------------------------------------
// Scenario 2 — Failure + Compensation
// ---------------------------------------------------------------------------

async function scenario2(useMock: boolean, apiKey?: string): Promise<void> {
  logHeader("Scenario 2: Failure + Compensation");
  console.log(`  ${DIM}Prompt: "${EXPENSE_PROMPT}"${RESET}`);
  console.log(
    `  ${YELLOW}Config: mockEmail.failOnNextCall() \u2014 email will fail${RESET}\n`,
  );

  const { unwind, email, allTools } = setup();
  email.failOnNextCall({ type: "error" });
  const runId = unwind.startRun("expense-agent");

  const llm = useMock
    ? createMockClient("failure_compensation")
    : await createAnthropicClient(apiKey!, EXPENSE_SYSTEM, allTools, unwind);

  const result = await agentLoop({
    unwind,
    runId,
    prompt: EXPENSE_PROMPT,
    tools: allTools,
    llm,
  });

  if (result.error) {
    console.log(
      `  ${RED}Tool call failed at step ${result.steps - 1}. Initiating compensation...${RESET}\n`,
    );
  }

  const summary = await unwind.compensate(runId);
  logCompensation(summary);
  logRunStatus(unwind, runId);
  unwind.close();
}

// ---------------------------------------------------------------------------
// Scenario 3 — Partial Compensation (email sent, later step fails)
// ---------------------------------------------------------------------------

async function scenario3(useMock: boolean, apiKey?: string): Promise<void> {
  logHeader("Scenario 3: Partial Compensation");
  console.log(`  ${DIM}Prompt: "${EXPENSE_PROMPT}"${RESET}`);
  console.log(
    `  ${YELLOW}Config: email succeeds, then next charge_card fails${RESET}\n`,
  );

  const { unwind, stripe, allTools } = setup();
  const runId = unwind.startRun("expense-agent");

  const llm = useMock
    ? createMockClient("partial_compensation")
    : await createAnthropicClient(apiKey!, EXPENSE_SYSTEM, allTools, unwind);

  const result = await agentLoop({
    unwind,
    runId,
    prompt: EXPENSE_PROMPT,
    tools: allTools,
    llm,
    beforeStep: (step) => {
      // Inject failure right before the 5th tool call
      if (step === 4) {
        stripe.failOnNextCall({ type: "error" });
      }
    },
  });

  if (result.error) {
    console.log(
      `  ${RED}Tool call failed at step ${result.steps - 1}. Initiating compensation...${RESET}\n`,
    );
  }

  const summary = await unwind.compensate(runId);
  logCompensation(summary);
  logRunStatus(unwind, runId);
  unwind.close();
}

// ---------------------------------------------------------------------------
// Scenario 4 — Fork from Checkpoint
// ---------------------------------------------------------------------------

async function scenario4(useMock: boolean, apiKey?: string): Promise<void> {
  logHeader("Scenario 4: Fork from Checkpoint");

  // --- Base run (same as scenario 2: email fails at step 3) ---
  console.log(`  ${BOLD}--- Base Run (email will fail) ---${RESET}\n`);

  const { unwind, email, allTools } = setup();
  email.failOnNextCall({ type: "error" });
  const baseRunId = unwind.startRun("expense-agent");

  const baseLlm = useMock
    ? createMockClient("failure_compensation")
    : await createAnthropicClient(apiKey!, EXPENSE_SYSTEM, allTools, unwind);

  await agentLoop({
    unwind,
    runId: baseRunId,
    prompt: EXPENSE_PROMPT,
    tools: allTools,
    llm: baseLlm,
  });

  logRunStatus(unwind, baseRunId);

  // --- Fork from step 2 (keep check_balance + classify_expense, re-run from charge_card) ---
  const forkFromStep = 2;
  console.log(
    `  ${BOLD}--- Forked Run (from step ${forkFromStep}: replay steps 0\u20131, re-execute 2+) ---${RESET}\n`,
  );

  const forkedRunId = unwind.fork(baseRunId, { fromStep: forkFromStep });

  const forkLlm = useMock
    ? createMockClient("fork_retry")
    : await createAnthropicClient(apiKey!, EXPENSE_SYSTEM, allTools, unwind);

  const forkResult = await agentLoop({
    unwind,
    runId: forkedRunId,
    prompt: EXPENSE_PROMPT,
    tools: allTools,
    llm: forkLlm,
    forkFromStep,
  });

  if (forkResult.text) {
    console.log(`  ${BOLD}Agent:${RESET} "${forkResult.text}"\n`);
  }

  logRunStatus(unwind, forkedRunId);

  // --- Comparison ---
  const baseRun = unwind.getRun(baseRunId)!;
  const forkRun = unwind.getRun(forkedRunId)!;
  console.log(`  ${BOLD}\u2500\u2500 Comparison \u2500\u2500${RESET}`);
  console.log(
    `  ${DIM}  Base run:   ${baseRun.id.slice(0, 8)}...  status=${RESET}${statusColor(baseRun.status)}${baseRun.status}${RESET}${DIM}  events=${baseRun.events.length}${RESET}`,
  );
  console.log(
    `  ${DIM}  Forked run: ${forkRun.id.slice(0, 8)}...  status=${RESET}${statusColor(forkRun.status)}${forkRun.status}${RESET}${DIM}  events=${forkRun.events.length}  parent=${baseRun.id.slice(0, 8)}...  forkFromStep=${forkFromStep}${RESET}`,
  );
  console.log();

  unwind.close();
}

// ---------------------------------------------------------------------------
// Scenario 5 — Destructive + Approval Gate
// ---------------------------------------------------------------------------

async function scenario5(useMock: boolean, apiKey?: string): Promise<void> {
  logHeader("Scenario 5: Destructive Tool + Approval Gate");
  const deletePrompt =
    "Delete the account for jchen@acme.com. Reason: Employee termination.";
  console.log(`  ${DIM}Prompt: "${deletePrompt}"${RESET}`);
  console.log(
    `  ${YELLOW}Config: approval gate (auto-approve in demo mode)${RESET}\n`,
  );

  const { unwind, tools, allTools } = setup();
  const deleteTools = [tools.deleteAccount];

  unwind.configure({
    approvalGate: async (call) => {
      console.log(
        `  ${MAGENTA}  Approval requested: ${call.toolName}${RESET}`,
      );
      console.log(
        `  ${MAGENTA}    args: ${fmtVal(call.args)}${RESET}`,
      );
      console.log(
        `  ${GREEN}    \u2713 Auto-approved (demo mode)${RESET}\n`,
      );
      return true;
    },
  });

  const runId = unwind.startRun("account-agent");

  const llm = useMock
    ? createMockClient("destructive_approval")
    : await createAnthropicClient(
        apiKey!,
        DELETE_SYSTEM,
        deleteTools,
        unwind,
      );

  const result = await agentLoop({
    unwind,
    runId,
    prompt: deletePrompt,
    tools: useMock ? allTools : deleteTools,
    llm,
  });

  if (result.text) {
    console.log(`  ${BOLD}Agent:${RESET} "${result.text}"\n`);
  }

  logEvents(unwind, runId);
  logRunStatus(unwind, runId);
  unwind.close();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  let useMock = !apiKey;

  // Probe for SDK availability when key is present
  if (apiKey) {
    try {
      await import("@anthropic-ai/sdk");
    } catch {
      console.log(
        `\n  ${YELLOW}@anthropic-ai/sdk not installed \u2014 falling back to mock LLM.${RESET}`,
      );
      console.log(
        `  ${DIM}Install with: npm install @anthropic-ai/sdk${RESET}`,
      );
      useMock = true;
    }
  }

  const mode = useMock
    ? "Mock LLM (set ANTHROPIC_API_KEY for real Claude calls)"
    : "Anthropic Claude (live API)";

  const banner = "\u2550".repeat(70);
  console.log(`\n${BOLD}${banner}${RESET}`);
  console.log(`${BOLD}  Unwind Demo \u2014 AI Agent Saga Pattern${RESET}`);
  console.log(`${DIM}  Mode: ${mode}${RESET}`);
  console.log(`${BOLD}${banner}${RESET}`);

  await scenario1(useMock, apiKey);
  await scenario2(useMock, apiKey);
  await scenario3(useMock, apiKey);
  await scenario4(useMock, apiKey);
  await scenario5(useMock, apiKey);

  const bar = "\u2550".repeat(70);
  console.log(`${BOLD}${bar}${RESET}`);
  console.log(`${BOLD}  Demo Complete${RESET}`);
  console.log(`${BOLD}${bar}${RESET}\n`);
}

main().catch((err) => {
  console.error(`\n${RED}Fatal: ${err.message}${RESET}\n`);
  process.exit(1);
});

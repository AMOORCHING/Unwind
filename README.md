# Unwind

Typed effect classification and automatic compensation for LLM agent tool calls. Middleware — not an execution engine. Composes with LangGraph, Temporal, or standalone.

Your agent charges a card at step 4. Step 6 fails. LangGraph can resume from a checkpoint. Temporal can retry the activity. Neither one refunds the charge. That's what Unwind does. It wraps each tool call with an effect class — idempotent, reversible, append-only, or destructive — and uses that classification to drive retry policy, idempotency key generation, and automatic compensation when a run fails.

![Unwind trace debugger](./docs/demo.gif)

## Quickstart

```ts
// quickstart.ts — run with: npx tsx quickstart.ts
import { Unwind } from "@unwind/core";

async function main() {
  // 1. Initialize Unwind with a SQLite event store
  const unwind = new Unwind({ store: "sqlite", dbPath: "./unwind.db" });

  // 2. Define tools with effect classes

  const checkBalance = unwind.tool({
    name: "check_balance",
    effectClass: "idempotent",
    description: "Check account balance",
    args: {
      account_id: { type: "string", stable: true },
    },
    execute: async (args) => {
      return { balance: 50000, currency: "USD" };
    },
  });

  const chargeCard = unwind.tool({
    name: "charge_card",
    effectClass: "reversible",
    description: "Charge a corporate card",
    args: {
      amount: { type: "number", stable: true },
      source: { type: "string", stable: true },
      description: { type: "string", stable: true },
    },
    execute: async (args) => {
      return { id: "ch_" + Math.random().toString(36).slice(2, 10), amount: args.amount, status: "succeeded" };
    },
    compensate: async (_originalArgs, originalResult) => {
      const charge = originalResult as { id: string };
      return { id: "re_" + Math.random().toString(36).slice(2, 10), charge: charge.id, status: "refunded" };
    },
  });

  const sendEmail = unwind.tool({
    name: "send_email",
    effectClass: "append-only",
    description: "Send a notification email",
    args: {
      to: { type: "string", stable: true },
      subject: { type: "string", stable: true },
      body: { type: "string", stable: false },
    },
    execute: async (args) => {
      return { id: "email_" + Math.random().toString(36).slice(2, 10), status: "sent" };
    },
  });

  // 3. Run a workflow
  const runId = unwind.startRun("quickstart-agent");

  await unwind.dispatch(runId, 0, checkBalance, { account_id: "user@acme.com" });
  await unwind.dispatch(runId, 1, chargeCard, { amount: 34000, source: "user@acme.com", description: "Team dinner" });
  await unwind.dispatch(runId, 2, sendEmail, { to: "user@acme.com", subject: "Charged", body: "Your card was charged $340." });

  console.log("Run completed:", runId);

  // 4. Simulate failure on a new run
  const failedRunId = unwind.startRun("quickstart-agent");

  await unwind.dispatch(failedRunId, 0, checkBalance, { account_id: "user@acme.com" });
  await unwind.dispatch(failedRunId, 1, chargeCard, { amount: 34000, source: "user@acme.com", description: "Team dinner" });

  // Step 2 fails — email service is down
  try {
    await unwind.dispatch(failedRunId, 2, {
      ...sendEmail,
      execute: async () => { throw new Error("ECONNREFUSED"); },
    }, { to: "user@acme.com", subject: "Charged", body: "Your card was charged $340." });
  } catch {
    console.log("Step 2 failed. Compensating...");
  }

  // 5. Compensate
  const summary = await unwind.compensate(failedRunId);
  console.log("\nCompensation summary:");
  console.log("  Compensated:", summary.compensated.map((c) => `${c.toolName} → ${JSON.stringify(c.compensationResult)}`));
  console.log("  Uncompensatable:", summary.uncompensatable.map((u) => `${u.toolName} (${u.reason})`));
  console.log("  Failed:", summary.failed.length === 0 ? "(none)" : summary.failed);

  // 6. Inspect via CLI
  console.log("\nInspect this run with:");
  console.log(`  npx unwind inspect ${failedRunId} --db ./unwind.db`);

  // 7. Open the debugger: npm run debugger → drop unwind.db → see the timeline

  unwind.close();
}

main();
```

Run it:

```bash
npm install @unwind/core
npx tsx quickstart.ts
```

Expected output:

```
Run completed: <run-id>
Step 2 failed. Compensating...

Compensation summary:
  Compensated: [ 'charge_card → {"id":"re_...","charge":"ch_...","status":"refunded"}' ]
  Uncompensatable: []
  Failed: (none)

Inspect this run with:
  npx unwind inspect <run-id> --db ./unwind.db
```

Inspect the run with the CLI:

```bash
npx unwind inspect <run-id> --db ./unwind.db
```

```
Run: <run-id>
Agent: quickstart-agent  Status: compensated

  step 0  check_balance [idempotent]  → {"balance":50000,"currency":"USD"}  (0ms)
  step 1  charge_card [reversible]  → {"id":"ch_...","status":"succeeded"}  (0ms)
  step 2  send_email [append-only]  ✗ ECONNREFUSED  [execution_error]
    ↩ compensating charge_card…
    ↩ compensated → {"id":"re_...","status":"refunded"}  (0ms)

Compensation Summary:
  Compensated: charge_card (...)
  Uncompensatable: (none)
  Failed: (none)
```

Open the trace debugger:

```bash
npm run debugger
```

Drop `unwind.db` into the browser to see the full timeline.

## Effect Classes

| Class | Meaning | Retry | Compensation | Example |
|---|---|---|---|---|
| `idempotent` | No side effects | Unlimited | None needed | DB reads, balance checks |
| `reversible` | Has a defined undo | With idempotency key | Runs `compensate()` automatically | Card charge → refund |
| `append-only` | Cannot be undone | With idempotency key | Logs what can't be reversed | Send email, post to Slack |
| `destructive` | Irreversible + high-impact | Blocked without approval | Escalates to human | Delete account, regulatory filing |

The effect class isn't a comment. It drives runtime behavior — retry policy, idempotency key generation, compensation strategy, and approval gating are all determined by the class you declare. Destructive tools won't execute without an approval gate. Reversible tools must provide a `compensate` function at definition time.

## Framework Integration

### Anthropic SDK

```ts
const tools = [checkBalance, chargeCard, sendEmail];
const toolDefs = unwind.anthropicTools(tools);

// In your message loop:
const result = await unwind.handleToolUse(runId, stepIndex, toolUseBlock, tools);
// result is an AnthropicToolResultBlock — feed it back to messages.create()

// On failure:
const summary = await unwind.compensate(runId);
```

### LangGraph

```ts
import { toLangGraphTools } from "@unwind/core";

let step = 0;
const lgTools = toLangGraphTools(tools, async (tool, args) => {
  return unwind.dispatch(runId, step++, tool, args);
});

// Pass lgTools to createReactAgent or ToolNode.
// LangGraph handles checkpointing. Unwind handles compensation.
```

### Temporal

```ts
// Inside a Temporal workflow activity:
async function chargeCardActivity(args: ChargeArgs) {
  const runId = unwind.startRun("temporal-agent");
  try {
    return await unwind.dispatch(runId, 0, chargeCard, args);
  } catch (err) {
    await unwind.compensate(runId);
    throw err;
  }
}

// Temporal handles durability and retries. Unwind handles compensation.
```

Unwind doesn't care what runs your agent. It wraps tool calls. Bring your own execution engine.

## CLI

```bash
unwind list --db ./unwind.db
```

```
Run ID       Agent ID             Status                 Tool Calls   Compensations   Created
──────────────────────────────────────────────────────────────────────────────────────────────
a1b2c3d4e…   quickstart-agent     compensated            3            1               2025-01-15T...
f5e6d7c8b…   expense-agent        failed                 4            0               2025-01-15T...
```

```bash
unwind inspect <run-id> --db ./unwind.db
```

```
Run: a1b2c3d4e...
Agent: quickstart-agent  Status: compensated

  step 0  check_balance [idempotent]  → {"balance":50000}  (1ms)
  step 1  charge_card [reversible]  → {"id":"ch_abc"}  (3ms)
  step 2  send_email [append-only]  ✗ ECONNREFUSED  [execution_error]
    ↩ compensating charge_card…
    ↩ compensated → {"id":"re_xyz"}  (2ms)
```

```bash
unwind compensate <run-id> --db ./unwind.db
```

```
Compensation Summary:
  Compensated: charge_card (re_xyz → {"status":"refunded"})
  Uncompensatable: (none)
  Failed: (none)

Final status: compensated
```

```bash
unwind fork <run-id> --from-step 2 --db ./unwind.db
```

```
Forked run: <new-run-id>
Parent: <run-id>
Replayed steps: 0, 1
Live execution resumes from step 2
```

```bash
unwind summary <run-id> --db ./unwind.db
```

```
Compensation Summary:
  Compensated: charge_card (re_xyz → {"status":"refunded"})
  Uncompensatable: (none)
  Failed: (none)
```

## Trace Debugger

![Unwind trace debugger](./docs/debugger.png)

Drop your `unwind.db` into the browser. See every tool call, effect class, and compensation outcome. Copy CLI commands to compensate or fork directly from the UI.

## How It Works

Unwind wraps your tool calls with a middleware that checks the declared effect class, generates a deterministic idempotency key from stable arguments, logs the call and result to an append-only event store, and provides a compensation runner that walks completed tool calls in reverse order — applying the strategy dictated by each tool's effect class. Reversible calls execute their `compensate` function, append-only calls are logged as uncompensatable, and destructive calls escalate to human review. The event store is SQLite locally, pluggable for production via the `EventStore` interface. The debugger reads the same SQLite file.

## What Unwind Is Not

- Not an execution engine. Use LangGraph, Temporal, or Inngest for that.
- Not an observability tool. Use LangSmith, Braintrust, or Arize for tracing.
- Not a Temporal replacement. It composes with Temporal.
- Not an agent framework. It's middleware for tool calls.

## License

MIT

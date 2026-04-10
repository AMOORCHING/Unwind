"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// quickstart.ts — run with: npx tsx quickstart.ts
const core_1 = require("@unwind/core");
async function main() {
    // 1. Initialize Unwind with a SQLite event store
    const unwind = new core_1.Unwind({ store: "sqlite", dbPath: "./unwind.db" });
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
            const charge = originalResult;
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
    }
    catch {
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
//# sourceMappingURL=quickstart.js.map
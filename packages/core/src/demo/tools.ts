import type { Unwind } from "../unwind.js";
import type { MockStripe, MockEmail, MockDB } from "./mocks.js";

interface DemoMocks {
  stripe: MockStripe;
  email: MockEmail;
  db: MockDB;
}

export function createDemoTools(unwind: Unwind, mocks: DemoMocks) {
  const checkBalance = unwind.tool({
    name: "check_balance",
    effectClass: "idempotent",
    description: "Check the account balance for an employee",
    args: {
      account_id: { type: "string", stable: true },
    },
    execute: async (args) =>
      mocks.db.accounts.getBalance(args.account_id as string),
  });

  const classifyExpense = unwind.tool({
    name: "classify_expense",
    effectClass: "idempotent",
    description:
      "Classify an expense description into a category and risk level",
    args: {
      description: { type: "string", stable: true },
    },
    execute: async (args) =>
      mocks.db.expenses.classify(args.description as string),
  });

  const chargeCard = unwind.tool({
    name: "charge_card",
    effectClass: "reversible",
    description: "Charge an employee's corporate card for an expense",
    args: {
      amount: { type: "number", stable: true },
      source: { type: "string", stable: true },
      description: { type: "string", stable: true },
    },
    execute: async (args) =>
      mocks.stripe.charges.create({
        amount: args.amount as number,
        source: args.source as string,
        description: args.description as string,
        idempotency_key: args.__idempotencyKey,
      }),
    compensate: async (_originalArgs, originalResult) => {
      const charge = originalResult as { id: string };
      return mocks.stripe.refunds.create({ charge: charge.id });
    },
  });

  const sendNotification = unwind.tool({
    name: "send_notification",
    effectClass: "append-only",
    description: "Send an email notification to an employee",
    args: {
      to: { type: "string", stable: true },
      subject: { type: "string", stable: true },
      body: { type: "string", stable: false },
    },
    execute: async (args) =>
      mocks.email.send({
        to: args.to as string,
        subject: args.subject as string,
        body: args.body as string,
      }),
  });

  const deleteAccount = unwind.tool({
    name: "delete_account",
    effectClass: "destructive",
    description:
      "Permanently delete an employee account and all associated data",
    args: {
      account_id: { type: "string", stable: true },
      reason: { type: "string", stable: true },
    },
    execute: async (args) =>
      mocks.db.accounts.delete(args.account_id as string),
  });

  return {
    checkBalance,
    classifyExpense,
    chargeCard,
    sendNotification,
    deleteAccount,
  };
}

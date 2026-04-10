import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// MockStripe
// ---------------------------------------------------------------------------

interface ChargeParams {
  amount: number;
  source: string;
  description: string;
  idempotency_key?: string;
}

interface Charge {
  id: string;
  amount: number;
  source: string;
  status: "succeeded";
}

interface Refund {
  id: string;
  charge: string;
  status: "succeeded";
}

type FailConfig =
  | { type: "error" }
  | { type: "timeout"; afterMs?: number };

export class MockStripe {
  private idempotencyCache = new Map<string, Charge>();
  private nextFailure: FailConfig | null = null;

  charges = {
    create: async (params: ChargeParams): Promise<Charge> => {
      await this.applyFailure();

      if (params.idempotency_key && this.idempotencyCache.has(params.idempotency_key)) {
        return this.idempotencyCache.get(params.idempotency_key)!;
      }

      const charge: Charge = {
        id: "ch_" + randomUUID().slice(0, 8),
        amount: params.amount,
        source: params.source,
        status: "succeeded",
      };

      if (params.idempotency_key) {
        this.idempotencyCache.set(params.idempotency_key, charge);
      }

      return charge;
    },
  };

  refunds = {
    create: async (params: { charge: string }): Promise<Refund> => ({
      id: "re_" + randomUUID().slice(0, 8),
      charge: params.charge,
      status: "succeeded",
    }),
  };

  failOnNextCall(config: FailConfig): void {
    this.nextFailure = config;
  }

  reset(): void {
    this.idempotencyCache.clear();
    this.nextFailure = null;
  }

  private async applyFailure(): Promise<void> {
    if (!this.nextFailure) return;
    const f = this.nextFailure;
    this.nextFailure = null;

    if (f.type === "timeout") {
      await new Promise((r) => setTimeout(r, f.afterMs ?? 100));
      throw new Error("Stripe timeout: request did not complete");
    }
    throw new Error("Stripe error: card_declined");
  }
}

// ---------------------------------------------------------------------------
// MockEmail
// ---------------------------------------------------------------------------

interface EmailParams {
  to: string;
  subject: string;
  body: string;
}

interface EmailResult {
  id: string;
  status: "sent";
}

export class MockEmail {
  private nextFailure: { type: "error" } | null = null;

  async send(_params: EmailParams): Promise<EmailResult> {
    if (this.nextFailure) {
      this.nextFailure = null;
      throw new Error("Email service unavailable: ECONNREFUSED");
    }
    return { id: "email_" + randomUUID().slice(0, 8), status: "sent" };
  }

  failOnNextCall(_config: { type: "error" }): void {
    this.nextFailure = { type: "error" };
  }

  reset(): void {
    this.nextFailure = null;
  }
}

// ---------------------------------------------------------------------------
// MockDB
// ---------------------------------------------------------------------------

const BALANCES: Record<string, number> = {
  "jchen@acme.com": 500_000,   // $5,000.00 in cents
  "admin@acme.com": 1_000_000, // $10,000.00
};

const CATEGORIES: Array<{
  pattern: string;
  category: string;
  riskLevel: "low" | "medium" | "high";
}> = [
  { pattern: "dinner", category: "meals_entertainment", riskLevel: "low" },
  { pattern: "lunch", category: "meals_entertainment", riskLevel: "low" },
  { pattern: "flight", category: "travel", riskLevel: "medium" },
  { pattern: "hotel", category: "travel", riskLevel: "medium" },
  { pattern: "software", category: "software_subscriptions", riskLevel: "low" },
  { pattern: "equipment", category: "equipment", riskLevel: "medium" },
];

export class MockDB {
  private deleted = new Set<string>();

  accounts = {
    getBalance: async (
      accountId: string,
    ): Promise<{ balance: number; currency: "USD" }> => ({
      balance: BALANCES[accountId] ?? 100_000,
      currency: "USD",
    }),

    delete: async (
      accountId: string,
    ): Promise<{ deleted: true; accountId: string }> => {
      this.deleted.add(accountId);
      return { deleted: true, accountId };
    },
  };

  expenses = {
    classify: async (
      description: string,
    ): Promise<{ category: string; riskLevel: "low" | "medium" | "high" }> => {
      const lower = description.toLowerCase();
      for (const { pattern, category, riskLevel } of CATEGORIES) {
        if (lower.includes(pattern)) return { category, riskLevel };
      }
      return { category: "miscellaneous", riskLevel: "high" };
    },
  };

  reset(): void {
    this.deleted.clear();
  }
}

#!/usr/bin/env node

import { Command } from "commander";
import { SQLiteEventStore } from "./store.js";
import { getCompensationSummary } from "./compensate.js";
import { fork } from "./fork.js";
import type {
  RunStatus,
  UnwindEvent,
  ToolCallTracked,
  ToolCallCompleted,
  ToolCallFailed,
  CompensationStarted,
  CompensationCompleted,
  CompensationFailed,
} from "./types.js";
import type { CompensationSummary } from "./compensate.js";

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function truncate(str: string, len: number): string {
  if (str.length <= len) return str;
  return str.slice(0, len - 1) + "…";
}

function badge(effectClass: string): string {
  const badges: Record<string, string> = {
    idempotent: "[idempotent]",
    reversible: "[reversible]",
    "append-only": "[append-only]",
    destructive: "[DESTRUCTIVE]",
  };
  return badges[effectClass] ?? `[${effectClass}]`;
}

function pad(str: string, width: number): string {
  return str.padEnd(width);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function summarizeResult(result: unknown): string {
  if (result === null || result === undefined) return "(null)";
  const s = typeof result === "string" ? result : JSON.stringify(result);
  return truncate(s, 60);
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

export function listRuns(store: SQLiteEventStore, status?: string): string {
  const filter = status ? { status: status as RunStatus } : undefined;
  const runs = store.listRuns(filter);

  if (runs.length === 0) {
    return "No runs found.";
  }

  const events = new Map<string, UnwindEvent[]>();
  for (const run of runs) {
    events.set(run.id, store.getEvents(run.id));
  }

  const header = `${pad("Run ID", 12)} ${pad("Agent ID", 20)} ${pad("Status", 22)} ${pad("Tool Calls", 12)} ${pad("Compensations", 15)} Created`;
  const sep = "─".repeat(header.length);

  const rows = runs.map((run) => {
    const evts = events.get(run.id) ?? [];
    const toolCalls = evts.filter((e) => e.type === "ToolCallTracked").length;
    const compensations = evts.filter(
      (e) =>
        e.type === "CompensationCompleted" || e.type === "CompensationFailed"
    ).length;

    return `${pad(truncate(run.id, 11), 12)} ${pad(run.agentId, 20)} ${pad(run.status, 22)} ${pad(String(toolCalls), 12)} ${pad(String(compensations), 15)} ${run.createdAt}`;
  });

  return [header, sep, ...rows].join("\n");
}

// ---------------------------------------------------------------------------
// inspect
// ---------------------------------------------------------------------------

export function inspectRun(store: SQLiteEventStore, runId: string): string {
  const run = store.getRun(runId);
  if (!run) return `Run "${runId}" not found.`;

  const lines: string[] = [];
  lines.push(`Run: ${run.id}`);
  lines.push(`Agent: ${run.agentId}  Status: ${run.status}`);
  if (run.parentRunId) {
    lines.push(`Forked from: ${run.parentRunId} at step ${run.forkFromStep}`);
  }
  lines.push("");

  const trackedByCallId = new Map<string, ToolCallTracked>();
  for (const e of run.events) {
    if (e.type === "ToolCallTracked") trackedByCallId.set(e.toolCallId, e);
  }

  for (const e of run.events) {
    switch (e.type) {
      case "ToolCallTracked": {
        // Will be printed when Completed/Failed arrives; skip standalone
        break;
      }
      case "ToolCallCompleted": {
        const tracked = trackedByCallId.get(e.toolCallId);
        if (!tracked) break;
        lines.push(
          `  step ${tracked.stepIndex}  ${tracked.toolName} ${badge(tracked.effectClass)}  → ${summarizeResult(e.result)}  (${formatDuration(e.durationMs)})`
        );
        break;
      }
      case "ToolCallFailed": {
        const tracked = trackedByCallId.get(e.toolCallId);
        const name = tracked?.toolName ?? "unknown";
        const ec = tracked ? badge(tracked.effectClass) : "";
        lines.push(
          `  step ${e.stepIndex}  ${name} ${ec}  ✗ ${String(e.error)}  [${e.reason}]`
        );
        break;
      }
      case "CompensationStarted": {
        const tracked = trackedByCallId.get(e.compensatingToolCallId);
        const name = tracked?.toolName ?? "unknown";
        lines.push(`    ↩ compensating ${name}…`);
        break;
      }
      case "CompensationCompleted": {
        lines.push(
          `    ↩ compensated → ${summarizeResult(e.result)}  (${formatDuration(e.durationMs)})`
        );
        break;
      }
      case "CompensationFailed": {
        lines.push(`    ↩ compensation failed: ${e.reason} — ${e.detail}`);
        break;
      }
      case "ApprovalRequested": {
        lines.push(
          `  step ${e.stepIndex}  ⚠ approval requested for ${e.toolName}`
        );
        break;
      }
      case "ApprovalReceived": {
        lines.push(
          `  step ${e.stepIndex}  ${e.approved ? "✓ approved" : "✗ denied"}`
        );
        break;
      }
      case "RunCompleted": {
        lines.push(`  ── run completed`);
        break;
      }
      case "RunFailed": {
        lines.push(`  ── run failed: ${e.message}`);
        break;
      }
    }
  }

  // Append compensation summary if any compensation events exist
  const hasCompensation = run.events.some(
    (e) =>
      e.type === "CompensationCompleted" ||
      e.type === "CompensationFailed" ||
      e.type === "CompensationStarted"
  );
  if (hasCompensation) {
    lines.push("");
    lines.push(formatCompensationSummary(getCompensationSummary(store, runId)));
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// summary
// ---------------------------------------------------------------------------

export function formatCompensationSummary(
  summary: CompensationSummary
): string {
  const lines: string[] = [];

  lines.push("Compensation Summary:");

  if (summary.compensated.length > 0) {
    lines.push(
      `  Compensated: ${summary.compensated
        .map(
          (c) =>
            `${c.toolName} (${truncate(String(c.toolCallId), 11)} → ${summarizeResult(c.compensationResult)})`
        )
        .join(", ")}`
    );
  } else {
    lines.push("  Compensated: (none)");
  }

  if (summary.uncompensatable.length > 0) {
    lines.push(
      `  Uncompensatable: ${summary.uncompensatable
        .map((u) => `${u.toolName} (${u.detail})`)
        .join(", ")}`
    );
  } else {
    lines.push("  Uncompensatable: (none)");
  }

  if (summary.failed.length > 0) {
    lines.push(
      `  Failed: ${summary.failed
        .map((f) => `${f.toolName} (${f.error})`)
        .join(", ")}`
    );
  } else {
    lines.push("  Failed: (none)");
  }

  if (summary.ambiguous.length > 0) {
    lines.push(
      `  Ambiguous: ${summary.ambiguous
        .map((a) => `${a.toolName} (${a.reason})`)
        .join(", ")}`
    );
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// compensate command
// ---------------------------------------------------------------------------

export function compensateRun(
  store: SQLiteEventStore,
  runId: string
): string {
  const summary = getCompensationSummary(store, runId);
  const run = store.getRun(runId);
  if (!run) return `Run "${runId}" not found.`;

  const lines: string[] = [];
  lines.push(formatCompensationSummary(summary));
  lines.push("");
  lines.push(`Final status: ${run.status}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// fork command
// ---------------------------------------------------------------------------

export function forkRun(
  store: SQLiteEventStore,
  parentRunId: string,
  fromStep: number
): string {
  const newRunId = fork(store, parentRunId, { fromStep });

  const newRun = store.getRun(newRunId);
  const replayedSteps = new Set(
    (newRun?.events ?? [])
      .filter((e) => e.type === "ToolCallCompleted")
      .map((e) => e.stepIndex)
  );

  const lines: string[] = [];
  lines.push(`Forked run: ${newRunId}`);
  lines.push(`Parent: ${parentRunId}`);
  lines.push(`Replayed steps: ${[...replayedSteps].sort((a, b) => a - b).join(", ") || "(none)"}`);
  lines.push(`Live execution resumes from step ${fromStep}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CLI program
// ---------------------------------------------------------------------------

export function createProgram(): Command {
  const program = new Command();
  program
    .name("unwind")
    .description("CLI for inspecting and managing Unwind runs")
    .version("0.1.0");

  program
    .option("--db <path>", "Path to SQLite database", "./unwind.db");

  // list
  program
    .command("list")
    .description("List runs from the event store")
    .option("--status <status>", "Filter by status")
    .action((opts, cmd) => {
      const dbPath = cmd.parent!.opts().db;
      const store = new SQLiteEventStore(dbPath);
      try {
        console.log(listRuns(store, opts.status));
      } finally {
        store.close();
      }
    });

  // inspect
  program
    .command("inspect <run-id>")
    .description("Print step-by-step tool call timeline for a run")
    .action((runId: string, _opts, cmd) => {
      const dbPath = cmd.parent!.opts().db;
      const store = new SQLiteEventStore(dbPath);
      try {
        console.log(inspectRun(store, runId));
      } finally {
        store.close();
      }
    });

  // compensate
  program
    .command("compensate <run-id>")
    .description("Show compensation summary for a run")
    .action((runId: string, _opts, cmd) => {
      const dbPath = cmd.parent!.opts().db;
      const store = new SQLiteEventStore(dbPath);
      try {
        console.log(compensateRun(store, runId));
      } finally {
        store.close();
      }
    });

  // fork
  program
    .command("fork <run-id>")
    .description("Fork a run from a specific step")
    .requiredOption("--from-step <n>", "Step index to fork from")
    .action((runId: string, opts, cmd) => {
      const dbPath = cmd.parent!.opts().db;
      const store = new SQLiteEventStore(dbPath);
      try {
        console.log(forkRun(store, runId, parseInt(opts.fromStep, 10)));
      } finally {
        store.close();
      }
    });

  // summary
  program
    .command("summary <run-id>")
    .description("Print compensation summary for a run")
    .action((runId: string, _opts, cmd) => {
      const dbPath = cmd.parent!.opts().db;
      const store = new SQLiteEventStore(dbPath);
      try {
        const run = store.getRun(runId);
        if (!run) {
          console.log(`Run "${runId}" not found.`);
          return;
        }
        const summary = getCompensationSummary(store, runId);
        console.log(formatCompensationSummary(summary));
      } finally {
        store.close();
      }
    });

  return program;
}

// ---------------------------------------------------------------------------
// Entry point when executed directly
// ---------------------------------------------------------------------------

const isDirectExecution =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("/cli.js") ||
    process.argv[1].endsWith("/cli.ts"));

if (isDirectExecution) {
  createProgram().parse(process.argv);
}

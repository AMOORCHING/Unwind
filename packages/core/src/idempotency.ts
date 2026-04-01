import { createHash } from "node:crypto";
import type { ArgSchema } from "./tool.js";

/**
 * Generate an idempotency key from run context and stable args.
 *
 * Formula: SHA-256(runId + stepIndex + toolName + JSON.stringify(sortedStableArgs))
 */
export function generateIdempotencyKey(
  runId: string,
  stepIndex: number,
  toolName: string,
  args: Record<string, unknown>,
  argSchema: ArgSchema
): string {
  const stableArgs = extractStableArgs(args, argSchema);
  const sorted = sortObject(stableArgs);
  const payload = runId + stepIndex + toolName + JSON.stringify(sorted);
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Filter args to only those marked stable in the schema.
 */
export function extractStableArgs(
  args: Record<string, unknown>,
  argSchema: ArgSchema
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(args)) {
    if (argSchema[key]?.stable) {
      result[key] = args[key];
    }
  }
  return result;
}

/**
 * Sort an object's keys alphabetically and return a new object.
 */
function sortObject(obj: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key];
  }
  return sorted;
}

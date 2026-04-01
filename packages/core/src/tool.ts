import type { EffectClass } from "./types.js";

// ---------------------------------------------------------------------------
// Arg schema
// ---------------------------------------------------------------------------

export interface ArgDef {
  type: string;
  stable: boolean;
}

export type ArgSchema = Record<string, ArgDef>;

// ---------------------------------------------------------------------------
// Tool definition (the metadata returned by .definition)
// ---------------------------------------------------------------------------

export interface ToolDefinition<A extends ArgSchema = ArgSchema> {
  name: string;
  effectClass: EffectClass;
  description: string;
  args: A;
}

// ---------------------------------------------------------------------------
// The wrapped tool object returned by defineTool()
// ---------------------------------------------------------------------------

/** Type-safe tool handle returned by defineTool / unwind.tool(). */
export interface UnwindTool<A extends ArgSchema = ArgSchema> {
  execute: (
    args: ArgsFromSchema<A> & { __idempotencyKey: string }
  ) => Promise<unknown>;
  compensate?: (
    originalArgs: ArgsFromSchema<A>,
    originalResult: unknown
  ) => Promise<unknown>;
  definition: ToolDefinition<A>;
}


// ---------------------------------------------------------------------------
// Map ArgSchema → runtime arg types (simplified: everything is unknown)
// ---------------------------------------------------------------------------

type ArgsFromSchema<A extends ArgSchema> = {
  [K in keyof A]: unknown;
};

// ---------------------------------------------------------------------------
// Conditional enforcement of compensate based on effectClass
// ---------------------------------------------------------------------------

interface ToolOptionsBase<A extends ArgSchema> {
  name: string;
  description: string;
  args: A;
  execute: (
    args: ArgsFromSchema<A> & { __idempotencyKey: string }
  ) => Promise<unknown>;
}

interface ReversibleToolOptions<A extends ArgSchema>
  extends ToolOptionsBase<A> {
  effectClass: "reversible";
  /** Required for reversible tools. */
  compensate: (
    originalArgs: ArgsFromSchema<A>,
    originalResult: unknown
  ) => Promise<unknown>;
}

interface IdempotentToolOptions<A extends ArgSchema>
  extends ToolOptionsBase<A> {
  effectClass: "idempotent";
  /** Forbidden for idempotent tools. */
  compensate?: never;
}

interface AppendOnlyToolOptions<A extends ArgSchema>
  extends ToolOptionsBase<A> {
  effectClass: "append-only";
  compensate?: (
    originalArgs: ArgsFromSchema<A>,
    originalResult: unknown
  ) => Promise<unknown>;
}

interface DestructiveToolOptions<A extends ArgSchema>
  extends ToolOptionsBase<A> {
  effectClass: "destructive";
  compensate?: (
    originalArgs: ArgsFromSchema<A>,
    originalResult: unknown
  ) => Promise<unknown>;
}

export type ToolOptions<A extends ArgSchema> =
  | ReversibleToolOptions<A>
  | IdempotentToolOptions<A>
  | AppendOnlyToolOptions<A>
  | DestructiveToolOptions<A>;

// ---------------------------------------------------------------------------
// defineTool — creates a wrapped tool
// ---------------------------------------------------------------------------

export function defineTool<A extends ArgSchema>(
  options: ToolOptions<A>
): UnwindTool<A> {
  return {
    execute: options.execute,
    compensate:
      "compensate" in options && typeof options.compensate === "function"
        ? options.compensate
        : undefined,
    definition: {
      name: options.name,
      effectClass: options.effectClass,
      description: options.description,
      args: options.args,
    },
  };
}

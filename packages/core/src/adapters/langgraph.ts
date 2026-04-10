import type { UnwindTool } from "../tool.js";

// ---------------------------------------------------------------------------
// LangGraph / LangChain-compatible tool definition
// ---------------------------------------------------------------------------

/**
 * Plain tool definition matching the shape LangGraph expects.
 * Developers can pass this directly to LangGraph's ToolNode or use
 * it to construct a DynamicStructuredTool.
 */
export interface LangGraphToolDefinition {
  name: string;
  description: string;
  schema: {
    type: "object";
    properties: Record<string, { type: string }>;
    required: string[];
  };
  func: (input: Record<string, unknown>) => Promise<string>;
}

// ---------------------------------------------------------------------------
// toLangGraphTools — convert Unwind tools to LangGraph-compatible format
// ---------------------------------------------------------------------------

/**
 * Convert an array of Unwind tools into LangGraph-compatible tool definitions.
 *
 * Each tool's `func` calls the provided `dispatch` callback, which should
 * wrap `unwind.dispatch()` with the appropriate runId and stepIndex.
 *
 * @example
 * ```ts
 * let step = 0;
 * const lgTools = toLangGraphTools(tools, async (tool, args) => {
 *   return unwind.dispatch(runId, step++, tool, args);
 * });
 * ```
 */
export function toLangGraphTools(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: UnwindTool<any>[],
  dispatch: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tool: UnwindTool<any>,
    args: Record<string, unknown>
  ) => Promise<unknown>
): LangGraphToolDefinition[] {
  return tools.map((tool) => toLangGraphTool(tool, dispatch));
}

/**
 * Convert a single Unwind tool into a LangGraph-compatible tool definition.
 */
export function toLangGraphTool(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool: UnwindTool<any>,
  dispatch: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tool: UnwindTool<any>,
    args: Record<string, unknown>
  ) => Promise<unknown>
): LangGraphToolDefinition {
  const properties: Record<string, { type: string }> = {};
  for (const [argName, argDef] of Object.entries(tool.definition.args)) {
    properties[argName] = { type: argDef.type };
  }

  return {
    name: tool.definition.name,
    description: tool.definition.description,
    schema: {
      type: "object" as const,
      properties,
      required: Object.keys(tool.definition.args),
    },
    func: async (input: Record<string, unknown>) => {
      const result = await dispatch(tool, input);
      return JSON.stringify(result);
    },
  };
}

// ---------------------------------------------------------------------------
// toDynamicStructuredTools — create real LangChain DynamicStructuredTool
// instances via dynamic import (requires @langchain/core + zod as peer deps)
// ---------------------------------------------------------------------------

const ZOD_TYPE_MAP: Record<string, string> = {
  string: "string",
  number: "number",
  boolean: "boolean",
  integer: "number",
};

/**
 * Create LangChain DynamicStructuredTool instances from Unwind tools.
 *
 * Requires `@langchain/core` and `zod` as peer dependencies.
 * Throws a clear error if either is missing.
 */
export async function toDynamicStructuredTools(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: UnwindTool<any>[],
  dispatch: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tool: UnwindTool<any>,
    args: Record<string, unknown>
  ) => Promise<unknown>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  let DynamicStructuredTool: any;
  let z: any;

  try {
    const toolsModule = await import("@langchain/core/tools");
    DynamicStructuredTool = toolsModule.DynamicStructuredTool;
  } catch {
    throw new Error(
      "@langchain/core is required for toDynamicStructuredTools(). " +
        "Install it with: npm install @langchain/core"
    );
  }

  try {
    const zodModule = await import("zod");
    z = zodModule.z ?? zodModule;
  } catch {
    throw new Error(
      "zod is required for toDynamicStructuredTools(). " +
        "Install it with: npm install zod"
    );
  }

  return tools.map((tool) => {
    const schemaFields: Record<string, unknown> = {};
    for (const [argName, argDef] of Object.entries(tool.definition.args)) {
      const zodType = ZOD_TYPE_MAP[argDef.type];
      schemaFields[argName] = zodType
        ? z[zodType]()
        : z.any();
    }

    return new DynamicStructuredTool({
      name: tool.definition.name,
      description: tool.definition.description,
      schema: z.object(schemaFields),
      func: async (input: Record<string, unknown>) => {
        const result = await dispatch(tool, input);
        return JSON.stringify(result);
      },
    });
  });
}

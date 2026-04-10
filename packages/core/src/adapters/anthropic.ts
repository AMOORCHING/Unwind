import type { UnwindTool, ArgSchema } from "../tool.js";

// ---------------------------------------------------------------------------
// Anthropic-compatible types (no SDK dependency required)
// ---------------------------------------------------------------------------

export interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, { type: string }>;
    required: string[];
  };
}

export interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

// ---------------------------------------------------------------------------
// toAnthropicTools — convert Unwind tools to Anthropic SDK tool definitions
// ---------------------------------------------------------------------------

export function toAnthropicTools(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: UnwindTool<any>[]
): AnthropicToolDefinition[] {
  return tools.map((tool) => {
    const properties: Record<string, { type: string }> = {};
    for (const [argName, argDef] of Object.entries(tool.definition.args) as [string, { type: string }][]) {
      properties[argName] = { type: argDef.type };
    }

    return {
      name: tool.definition.name,
      description: tool.definition.description,
      input_schema: {
        type: "object" as const,
        properties,
        required: Object.keys(tool.definition.args),
      },
    };
  });
}

// ---------------------------------------------------------------------------
// handleToolUse — dispatch an Anthropic tool_use block through Unwind
// ---------------------------------------------------------------------------

export async function handleToolUse(
  dispatch: (
    runId: string,
    stepIndex: number,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tool: UnwindTool<any>,
    args: Record<string, unknown>
  ) => Promise<unknown>,
  runId: string,
  stepIndex: number,
  toolUseBlock: AnthropicToolUseBlock,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: UnwindTool<any>[]
): Promise<AnthropicToolResultBlock> {
  const tool = tools.find((t) => t.definition.name === toolUseBlock.name);
  if (!tool) {
    throw new Error(
      `Unknown tool "${toolUseBlock.name}". Available: ${tools.map((t) => t.definition.name).join(", ")}`
    );
  }

  const result = await dispatch(runId, stepIndex, tool, toolUseBlock.input);

  return {
    type: "tool_result",
    tool_use_id: toolUseBlock.id,
    content: JSON.stringify(result),
  };
}

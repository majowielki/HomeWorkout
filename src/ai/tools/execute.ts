import {
  CHAT_TOOLS,
  toolResultSchemaFor,
  type ToolError,
  type ToolName,
} from '../contract/chatTools';
import type { ToolCall, ToolResult } from '../contract/chat';
import { TOOL_IMPLEMENTATIONS, type ToolEnvironment } from './implementations';

export interface ExecuteEnvironment extends ToolEnvironment {
  /**
   * Told when a tool threw or produced something its own schema refuses.
   * The model only ever hears "failed"; the reason is for the developer.
   */
  report?: (tool: ToolName, error: unknown) => void;
}

/**
 * Run one tool call the model asked for, and package the answer.
 *
 * The model's input is untrusted: it is parsed against the tool's input
 * schema before anything runs. The output goes through its schema on the
 * way out, which is the funnel that keeps a field nobody listed from
 * reaching a model (I9). Neither a bad request nor a broken tool ends the
 * conversation: both come back as a tool error the model can read and
 * answer around.
 */
export async function executeTool(call: ToolCall, env: ExecuteEnvironment): Promise<ToolResult> {
  const answer = (output: ToolResult['output']): ToolResult => ({
    callId: call.id,
    name: call.name,
    output,
  });
  const failed = (error: unknown): ToolResult => {
    env.report?.(call.name, error);
    return answer({ error: 'failed' } satisfies ToolError);
  };

  const input = CHAT_TOOLS[call.name].input.safeParse(call.input);
  if (!input.success) return answer({ error: 'invalid_input' } satisfies ToolError);

  let raw: unknown;
  try {
    // The union of tools is correlated with its input; TypeScript cannot follow that through a lookup.
    const run = TOOL_IMPLEMENTATIONS[call.name] as (
      i: unknown,
      e: ToolEnvironment,
    ) => Promise<unknown>;
    raw = await run(input.data, env);
  } catch (error) {
    return failed(error);
  }

  const checked = toolResultSchemaFor(call.name).safeParse(raw);
  return checked.success ? answer(checked.data) : failed(checked.error);
}

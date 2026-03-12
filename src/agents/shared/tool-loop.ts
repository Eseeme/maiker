/**
 * Agent Tool Loop
 *
 * Drives the LLM ↔ tool-use cycle:
 *   1. Send messages + tools to the model
 *   2. Model responds with text and/or tool_use blocks
 *   3. Execute each tool call on disk
 *   4. Send tool results back to the model
 *   5. Repeat until the model stops calling tools (end_turn)
 *
 * Works with the Anthropic messages API. Can be extended to other providers.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ModelConfig } from '../../types/index.js';
import { AGENT_TOOLS, executeTool } from './tools.js';
import type { ToolResult } from './tools.js';

export interface ToolLoopOptions {
  /** Model config (provider + model name) */
  modelConfig: ModelConfig;
  /** System prompt for the agent */
  systemPrompt: string;
  /** Initial user message */
  userMessage: string;
  /** Project root — tools resolve paths relative to this */
  projectPath: string;
  /** Max tool-call rounds before forcing stop (default: 30) */
  maxRounds?: number;
  /** Called each time a tool is executed */
  onToolCall?: (toolName: string, input: Record<string, string>, result: ToolResult) => void;
}

export interface ToolLoopResult {
  /** Final text response from the model */
  finalText: string;
  /** All files that were written during the loop */
  changedFiles: string[];
  /** Total tool calls made */
  toolCallCount: number;
}

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (!cachedClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set.');
    cachedClient = new Anthropic({ apiKey });
  }
  return cachedClient;
}

export async function runToolLoop(opts: ToolLoopOptions): Promise<ToolLoopResult> {
  const { modelConfig, systemPrompt, userMessage, projectPath } = opts;
  const maxRounds = opts.maxRounds ?? 30;

  if (modelConfig.provider !== 'claude') {
    throw new Error(
      `Tool loop currently supports claude provider only (got: ${modelConfig.provider}). ` +
      `Other providers can be added by implementing their tool_use API.`
    );
  }

  const client = getClient();
  const changedFiles: string[] = [];
  let toolCallCount = 0;

  // Build initial messages
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userMessage },
  ];

  for (let round = 0; round < maxRounds; round++) {
    // Call the model with tools
    const response = await client.messages.create({
      model: modelConfig.model,
      max_tokens: modelConfig.maxTokens ?? 16384,
      system: systemPrompt,
      tools: AGENT_TOOLS as Anthropic.Tool[],
      messages,
    });

    // Collect text and tool_use blocks
    const textBlocks: string[] = [];
    const toolUseBlocks: Array<{ id: string; name: string; input: Record<string, string> }> = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        textBlocks.push(block.text);
      } else if (block.type === 'tool_use') {
        toolUseBlocks.push({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, string>,
        });
      }
    }

    // If no tool calls, we're done
    if (toolUseBlocks.length === 0 || response.stop_reason === 'end_turn') {
      // If there were tool uses AND end_turn, we still need to process them
      if (toolUseBlocks.length === 0) {
        return {
          finalText: textBlocks.join('\n'),
          changedFiles,
          toolCallCount,
        };
      }
    }

    // Execute tool calls
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      toolCallCount++;
      const result = await executeTool(toolUse.name, toolUse.input, projectPath);

      // Track written files
      if (toolUse.name === 'write_file' && !result.isError) {
        const path = toolUse.input.path;
        if (!changedFiles.includes(path)) {
          changedFiles.push(path);
        }
      }

      if (opts.onToolCall) {
        opts.onToolCall(toolUse.name, toolUse.input, result);
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: result.output,
        is_error: result.isError,
      });
    }

    // Add assistant response + tool results to messages
    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });

    // If stop_reason was end_turn (with tool calls), process one more round
    if (response.stop_reason === 'end_turn') {
      return {
        finalText: textBlocks.join('\n'),
        changedFiles,
        toolCallCount,
      };
    }
  }

  // Hit max rounds
  return {
    finalText: `(stopped after ${maxRounds} tool-call rounds)`,
    changedFiles,
    toolCallCount,
  };
}

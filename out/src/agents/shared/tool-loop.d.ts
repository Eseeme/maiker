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
import type { ModelConfig } from '../../types/index.js';
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
export declare function runToolLoop(opts: ToolLoopOptions): Promise<ToolLoopResult>;
//# sourceMappingURL=tool-loop.d.ts.map
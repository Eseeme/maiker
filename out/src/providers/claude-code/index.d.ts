/**
 * Claude Code Subprocess Provider
 *
 * Uses Claude Code CLI as a subprocess to leverage the user's existing
 * OAuth authentication. This is the supported way to use Claude Code
 * credentials — OAuth tokens (sk-ant-oat*) cannot be used directly
 * with the Anthropic Messages API.
 *
 * How it works:
 *   1. Spawns `claude -p` (print mode) with permission bypass
 *   2. Passes system prompt via --system-prompt
 *   3. Claude Code handles tool use (file writes) internally
 *   4. Returns final text output
 *
 * This provider is auto-selected when:
 *   - The user has `claude` installed
 *   - ANTHROPIC_API_KEY starts with `sk-ant-oat` (OAuth token)
 *   - No direct API key is available
 */
import type { ModelConfig } from '../../types/index.js';
export interface LLMMessage {
    role: 'user' | 'assistant';
    content: string;
}
export interface LLMResponse {
    content: string;
    model: string;
    usage?: {
        inputTokens: number;
        outputTokens: number;
    };
}
export declare function isClaudeCodeAvailable(): boolean;
/**
 * Check if the current API key is an OAuth token (can't use Messages API).
 */
export declare function isOAuthToken(): boolean;
/**
 * Should we use Claude Code subprocess instead of direct API?
 */
export declare function shouldUseClaudeCode(): boolean;
/**
 * Call Claude via the Claude Code CLI subprocess.
 *
 * Uses `claude -p` (print mode) with:
 * - --dangerously-skip-permissions to avoid interactive prompts
 * - --output-format json for structured responses
 * - --model to route to the configured model
 * - --system-prompt for agent instructions
 * - --add-dir for project file access
 *
 * The subprocess runs with full tool access (Read, Write, Edit, Bash, etc.)
 * and uses the user's stored OAuth credentials automatically.
 */
export declare function claudeCodeComplete(config: ModelConfig, systemPrompt: string, userMessage: string, projectPath?: string): Promise<string>;
/**
 * Chat-style interface using Claude Code subprocess.
 * For multi-turn, we concatenate messages into a single prompt.
 */
export declare function claudeCodeChat(config: ModelConfig, systemPrompt: string, messages: LLMMessage[], projectPath?: string): Promise<LLMResponse>;
//# sourceMappingURL=index.d.ts.map
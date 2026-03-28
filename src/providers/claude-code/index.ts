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

import { execSync, spawn } from 'child_process';
import { writeFileSync, unlinkSync, mkdtempSync, rmdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ModelConfig } from '../../types/index.js';

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
}

/**
 * Check if Claude Code CLI is available and working.
 */
let _claudeAvailable: boolean | null = null;
export function isClaudeCodeAvailable(): boolean {
  if (_claudeAvailable !== null) return _claudeAvailable;
  try {
    const result = execSync('claude --version 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 5000,
    });
    _claudeAvailable = result.trim().length > 0;
  } catch {
    _claudeAvailable = false;
  }
  return _claudeAvailable;
}

/**
 * Check if the current API key is an OAuth token (can't use Messages API).
 */
export function isOAuthToken(): boolean {
  const key = process.env.ANTHROPIC_API_KEY ?? '';
  return key.startsWith('sk-ant-oat');
}

/**
 * Should we use Claude Code subprocess instead of direct API?
 */
export function shouldUseClaudeCode(): boolean {
  return isOAuthToken() && isClaudeCodeAvailable();
}

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
export async function claudeCodeComplete(
  config: ModelConfig,
  systemPrompt: string,
  userMessage: string,
  projectPath?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      '-p',                          // print mode (non-interactive)
      '--model', config.model,
      '--output-format', 'text',
      '--dangerously-skip-permissions',  // no interactive permission prompts
    ];

    // Add system prompt — keep it under OS arg limits
    // If too long, we'll prepend it to the user message via stdin
    let systemViaStdin = false;
    if (systemPrompt.length > 0 && systemPrompt.length <= 8000) {
      args.push('--system-prompt', systemPrompt);
    } else if (systemPrompt.length > 8000) {
      systemViaStdin = true;
    }

    // Add project directory access
    if (projectPath) {
      args.push('--add-dir', projectPath);
    }

    // Always pipe via stdin — avoids OS arg length limits with long prompts
    const useStdin = true;
    // Short messages could be args but stdin is safer for all cases

    const child = spawn('claude', args, {
      cwd: projectPath || process.cwd(),
      env: {
        ...process.env,
        CI: '1',  // prevent interactive behavior
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 300_000,  // 5 minute timeout
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0 || stdout.trim().length > 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(
          `Claude Code subprocess failed (exit ${code}):\n${stderr.slice(0, 500)}`
        ));
      }
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn Claude Code: ${err.message}`));
    });

    // Pipe the user message via stdin, then close
    if (systemViaStdin) {
      child.stdin.write(`<system-instructions>\n${systemPrompt}\n</system-instructions>\n\n`);
    }
    child.stdin.write(userMessage);
    child.stdin.end();
  });
}

/**
 * Chat-style interface using Claude Code subprocess.
 * For multi-turn, we concatenate messages into a single prompt.
 */
export async function claudeCodeChat(
  config: ModelConfig,
  systemPrompt: string,
  messages: LLMMessage[],
  projectPath?: string,
): Promise<LLMResponse> {
  const parts: string[] = [];
  for (const msg of messages) {
    if (msg.role === 'user') {
      parts.push(msg.content);
    } else {
      parts.push(`[Previous assistant response]:\n${msg.content}`);
    }
  }

  const content = await claudeCodeComplete(
    config,
    systemPrompt,
    parts.join('\n\n'),
    projectPath,
  );

  return {
    content,
    model: config.model,
  };
}

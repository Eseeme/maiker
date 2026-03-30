/**
 * Claude Code Subprocess Provider
 *
 * Uses Claude Code CLI as a subprocess to leverage the user's existing
 * OAuth authentication. This is the supported way to use Claude Code
 * credentials — OAuth tokens (sk-ant-oat*) cannot be used directly
 * with the Anthropic Messages API.
 *
 * How it works:
 *   1. Spawns `claude -p` (print mode) with scoped permissions
 *   2. Passes system prompt via --system-prompt
 *   3. Claude Code handles tool use (file writes) internally
 *   4. Returns final text output
 *
 * Security model:
 *   - Uses --permission-mode dontAsk (blocks everything not explicitly allowed)
 *   - Uses --allowedTools to scope reads/writes to the project directory
 *   - Allows standard build/test/lint commands via Bash patterns
 *   - No --dangerously-skip-permissions
 *
 * This provider is auto-selected when:
 *   - The user has `claude` installed
 *   - ANTHROPIC_API_KEY starts with `sk-ant-oat` (OAuth token)
 *   - No direct API key is available
 */

import { execSync, spawn } from 'child_process';
import type { ModelConfig } from '../../types/index.js';
import type { SecurityPolicy } from '../../core/guards/index.js';
import { DEFAULT_SECURITY_POLICY } from '../../core/guards/index.js';

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

// ─── Scoped Permission Builder ───────────────────────────────────────────────

/**
 * Build the --allowedTools patterns for the Claude Code subprocess.
 * Scopes operations to the project directory and safe commands.
 */
function buildAllowedTools(projectPath: string, policy: SecurityPolicy): string[] {
  const tools: string[] = [];

  // Read access: project-wide (always allowed)
  tools.push(`Read(${projectPath}/**)`);

  // Write/Edit access: project-wide (workspace and full modes)
  if (policy.mode !== 'safe') {
    tools.push(`Edit(${projectPath}/**)`);
    tools.push(`Write(${projectPath}/**)`);
  }

  // Glob/Grep for searching (always allowed, read-only)
  tools.push('Glob');
  tools.push('Grep');

  // Bash: standard development commands
  // Build/test/lint (always allowed)
  tools.push('Bash(npm run *)');
  tools.push('Bash(npm test *)');
  tools.push('Bash(npm exec *)');
  tools.push('Bash(npx *)');
  tools.push('Bash(yarn run *)');
  tools.push('Bash(pnpm run *)');
  tools.push('Bash(bun run *)');
  tools.push('Bash(node *)');
  tools.push('Bash(tsc *)');
  tools.push('Bash(tsx *)');

  // Read-only CLI commands
  tools.push('Bash(cat *)');
  tools.push('Bash(ls *)');
  tools.push('Bash(find *)');
  tools.push('Bash(grep *)');
  tools.push('Bash(wc *)');
  tools.push('Bash(head *)');
  tools.push('Bash(tail *)');

  if (policy.mode !== 'safe') {
    // Package management (workspace/full modes)
    tools.push('Bash(npm install *)');
    tools.push('Bash(npm add *)');
    tools.push('Bash(npm ci *)');
    tools.push('Bash(yarn install *)');
    tools.push('Bash(yarn add *)');
    tools.push('Bash(pnpm install *)');
    tools.push('Bash(pnpm add *)');

    // Git operations (safe subset)
    tools.push('Bash(git status *)');
    tools.push('Bash(git diff *)');
    tools.push('Bash(git log *)');
    tools.push('Bash(git add *)');
    tools.push('Bash(git commit *)');
    tools.push('Bash(git stash *)');
    tools.push('Bash(git checkout *)');
    tools.push('Bash(git branch *)');
    tools.push('Bash(git fetch *)');
    tools.push('Bash(git pull *)');
    tools.push('Bash(git worktree *)');
    tools.push('Bash(git show *)');
    tools.push('Bash(git rev-parse *)');
    tools.push('Bash(git tag *)');

    // Directory operations
    tools.push('Bash(mkdir *)');
    tools.push('Bash(cp *)');
    tools.push('Bash(mv *)');
    tools.push('Bash(rm *)');
    tools.push('Bash(touch *)');
    tools.push('Bash(chmod *)');

    // Linting/formatting
    tools.push('Bash(prettier *)');
    tools.push('Bash(eslint *)');
    tools.push('Bash(biome *)');

    // Test runners
    tools.push('Bash(jest *)');
    tools.push('Bash(vitest *)');
    tools.push('Bash(playwright *)');
  }

  // Add user-defined allowed commands
  for (const cmd of policy.allowedCommands) {
    tools.push(`Bash(${cmd})`);
  }

  return tools;
}

/**
 * Build the --disallowedTools patterns for explicit blocks.
 */
function buildDisallowedTools(policy: SecurityPolicy): string[] {
  const tools: string[] = [];

  // Always block dangerous git operations
  tools.push('Bash(git push --force *)');
  tools.push('Bash(git push -f *)');
  tools.push('Bash(git clean -f *)');
  tools.push('Bash(npm publish *)');

  // Add user-defined blocked commands
  for (const cmd of policy.blockedCommands) {
    tools.push(`Bash(${cmd})`);
  }

  return tools;
}

// ─── Claude Code Subprocess Execution ────────────────────────────────────────

/**
 * Call Claude via the Claude Code CLI subprocess with scoped permissions.
 *
 * Uses `claude -p` (print mode) with:
 * - --permission-mode dontAsk (block everything not explicitly allowed)
 * - --allowedTools for scoped read/write/bash access
 * - --disallowedTools for explicit dangerous command blocks
 * - --model to route to the configured model
 * - --system-prompt for agent instructions
 * - --add-dir for project file access
 */
export async function claudeCodeComplete(
  config: ModelConfig,
  systemPrompt: string,
  userMessage: string,
  projectPath?: string,
  timeoutMs?: number,
  securityPolicy?: SecurityPolicy,
): Promise<string> {
  const policy = securityPolicy ?? DEFAULT_SECURITY_POLICY;
  const resolvedProjectPath = projectPath || process.cwd();

  return new Promise((resolve, reject) => {
    const args = [
      '-p',                          // print mode (non-interactive)
      '--model', config.model,
      '--output-format', 'text',
      '--permission-mode', 'dontAsk', // block everything not explicitly allowed
    ];

    // Add scoped permissions
    const allowed = buildAllowedTools(resolvedProjectPath, policy);
    if (allowed.length > 0) {
      args.push('--allowedTools', ...allowed);
    }

    const disallowed = buildDisallowedTools(policy);
    if (disallowed.length > 0) {
      args.push('--disallowedTools', ...disallowed);
    }

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

    const child = spawn('claude', args, {
      cwd: resolvedProjectPath,
      env: {
        ...process.env,
        CI: '1',  // prevent interactive behavior
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs ?? 600_000,  // 10 minute default
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
  securityPolicy?: SecurityPolicy,
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
    undefined,
    securityPolicy,
  );

  return {
    content,
    model: config.model,
  };
}

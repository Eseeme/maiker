/**
 * Agent Tool Definitions & Execution
 *
 * Provides actual file system and shell tools that agents can call
 * via the LLM tool-use API. Each tool call is executed on disk.
 *
 * All operations go through the guards layer for:
 *   - Path sandboxing (stays within project root)
 *   - Command allow/deny lists
 *   - Sensitive file protection
 */

import fs from 'fs-extra';
import { resolve, dirname } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  guardFileOp,
  guardCommand,
  parseCommand,
  type SecurityPolicy,
  DEFAULT_SECURITY_POLICY,
} from '../../core/guards/index.js';
import type { PolicyHooks } from '../../core/hooks/index.js';

const execFileAsync = promisify(execFile);

// ─── Tool Definitions (Anthropic tool_use format) ────────────────────────────

export const AGENT_TOOLS = [
  {
    name: 'read_file',
    description: 'Read the contents of a file. Use this to understand existing code before modifying it.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Absolute or project-relative file path' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file. Creates parent directories if needed. Overwrites if the file exists.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Absolute or project-relative file path' },
        content: { type: 'string', description: 'Full file content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_directory',
    description: 'List files and directories at the given path. Returns names with trailing / for directories.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Directory path to list' },
      },
      required: ['path'],
    },
  },
  {
    name: 'run_command',
    description: 'Run a shell command in the project directory. Use for build, lint, test, etc. Returns stdout+stderr. Timeout: 60s.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: 'The command to run (e.g. "npm run build")' },
      },
      required: ['command'],
    },
  },
];

// ─── Tool Execution ──────────────────────────────────────────────────────────

export interface ToolResult {
  output: string;
  isError: boolean;
}

export async function executeTool(
  toolName: string,
  toolInput: Record<string, string>,
  projectPath: string,
  securityPolicy?: SecurityPolicy,
  hooks?: PolicyHooks,
): Promise<ToolResult> {
  const policy = securityPolicy ?? DEFAULT_SECURITY_POLICY;

  try {
    switch (toolName) {
      case 'read_file': {
        // Guard: path sandboxing + sensitive file check
        const guard = guardFileOp(toolInput.path, projectPath, 'read', policy);
        if (!guard.allowed) {
          return { output: `Blocked: ${guard.reason}`, isError: true };
        }
        const filePath = guard.resolved!;

        if (!await fs.pathExists(filePath)) {
          return { output: `File not found: ${toolInput.path}`, isError: true };
        }
        const stat = await fs.stat(filePath);
        if (stat.size > 512_000) {
          return { output: `File too large (${stat.size} bytes). Read a smaller file or a specific section.`, isError: true };
        }
        const content = await fs.readFile(filePath, 'utf-8');
        return { output: content, isError: false };
      }

      case 'write_file': {
        // Guard: path sandboxing + sensitive file + protected file check
        const guard = guardFileOp(toolInput.path, projectPath, 'write', policy);
        if (!guard.allowed) {
          return { output: `Blocked: ${guard.reason}`, isError: true };
        }
        const filePath = guard.resolved!;

        // Policy hook: preWrite (no-touch zones, secret scanning)
        if (hooks) {
          const hookResult = await hooks.preWrite(filePath, toolInput.content);
          if (hookResult.blocked) {
            return { output: `Blocked by policy: ${hookResult.reason}`, isError: true };
          }
        }

        await fs.ensureDir(dirname(filePath));
        await fs.writeFile(filePath, toolInput.content, 'utf-8');

        // Policy hook: postWrite (auto-formatting)
        if (hooks) {
          await hooks.postWrite(filePath);
        }

        return { output: `Written: ${toolInput.path} (${toolInput.content.length} bytes)`, isError: false };
      }

      case 'list_directory': {
        // Guard: path sandboxing (read operation)
        const guard = guardFileOp(toolInput.path, projectPath, 'read', policy);
        if (!guard.allowed) {
          return { output: `Blocked: ${guard.reason}`, isError: true };
        }
        const dirPath = guard.resolved!;

        if (!await fs.pathExists(dirPath)) {
          return { output: `Directory not found: ${toolInput.path}`, isError: true };
        }
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        const lines = entries
          .filter(e => !e.name.startsWith('.'))
          .map(e => e.isDirectory() ? `${e.name}/` : e.name);
        return { output: lines.join('\n') || '(empty directory)', isError: false };
      }

      case 'run_command': {
        // Guard: command allow/deny list check
        const guard = guardCommand(toolInput.command, policy);
        if (!guard.allowed) {
          return { output: `Blocked: ${guard.reason}`, isError: true };
        }

        // Policy hook: preCommand (additional command-level policy checks)
        if (hooks) {
          const hookResult = await hooks.preCommand(toolInput.command);
          if (hookResult.blocked) {
            return { output: `Blocked by policy: ${hookResult.reason}`, isError: true };
          }
        }

        // Parse command safely — uses execFile without shell: true for simple commands
        const { cmd, args } = parseCommand(toolInput.command);

        try {
          const { stdout, stderr } = await execFileAsync(cmd, args, {
            cwd: projectPath,
            timeout: 60_000,
            maxBuffer: 1024 * 1024,
          });
          const output = (stdout + (stderr ? `\nSTDERR:\n${stderr}` : '')).trim();
          return { output: output || '(no output)', isError: false };
        } catch (err: unknown) {
          const e = err as { stdout?: string; stderr?: string; message?: string };
          const output = [e.stdout, e.stderr, e.message].filter(Boolean).join('\n').trim();
          return { output: output || 'Command failed', isError: true };
        }
      }

      default:
        return { output: `Unknown tool: ${toolName}`, isError: true };
    }
  } catch (err) {
    return { output: `Tool error: ${String(err)}`, isError: true };
  }
}

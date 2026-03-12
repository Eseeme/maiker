/**
 * Agent Tool Definitions & Execution
 *
 * Provides actual file system and shell tools that agents can call
 * via the LLM tool-use API. Each tool call is executed on disk.
 */

import fs from 'fs-extra';
import { resolve, dirname } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

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
): Promise<ToolResult> {
  try {
    switch (toolName) {
      case 'read_file': {
        const filePath = resolve(projectPath, toolInput.path);
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
        const filePath = resolve(projectPath, toolInput.path);
        await fs.ensureDir(dirname(filePath));
        await fs.writeFile(filePath, toolInput.content, 'utf-8');
        return { output: `Written: ${toolInput.path} (${toolInput.content.length} bytes)`, isError: false };
      }

      case 'list_directory': {
        const dirPath = resolve(projectPath, toolInput.path);
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
        const [cmd, ...args] = toolInput.command.split(' ');
        try {
          const { stdout, stderr } = await execFileAsync(cmd, args, {
            cwd: projectPath,
            timeout: 60_000,
            shell: true,
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

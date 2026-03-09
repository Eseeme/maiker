import { execFile, spawn } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
}

export interface ShellOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
  maxBuffer?: number;
}

export async function runCommand(
  command: string,
  args: string[] = [],
  opts: ShellOptions = {},
): Promise<ShellResult> {
  const start = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: opts.cwd ?? process.cwd(),
      env: { ...process.env, ...opts.env },
      timeout: opts.timeout ?? 120_000,
      maxBuffer: opts.maxBuffer ?? 10 * 1024 * 1024, // 10 MB
    });
    return {
      stdout: stdout.toString(),
      stderr: stderr.toString(),
      exitCode: 0,
      duration: Date.now() - start,
    };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? String(err),
      exitCode: e.code ?? 1,
      duration: Date.now() - start,
    };
  }
}

export async function runShell(
  script: string,
  opts: ShellOptions = {},
): Promise<ShellResult> {
  return runCommand('sh', ['-c', script], opts);
}

export interface SpawnOptions extends ShellOptions {
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
}

export function spawnCommand(
  command: string,
  args: string[] = [],
  opts: SpawnOptions = {},
): Promise<ShellResult> {
  const start = Date.now();
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd: opts.cwd ?? process.cwd(),
      env: { ...process.env, ...opts.env },
      stdio: 'pipe',
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      if (opts.onStdout) {
        for (const line of text.split('\n')) {
          if (line) opts.onStdout(line);
        }
      }
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      if (opts.onStderr) {
        for (const line of text.split('\n')) {
          if (line) opts.onStderr(line);
        }
      }
    });

    proc.on('close', (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 0,
        duration: Date.now() - start,
      });
    });

    if (opts.timeout) {
      setTimeout(() => {
        proc.kill();
        resolve({
          stdout,
          stderr: stderr + '\nProcess timed out',
          exitCode: 124,
          duration: Date.now() - start,
        });
      }, opts.timeout);
    }
  });
}

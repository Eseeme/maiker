import { spawnCommand } from '../shell/index.js';
import type { PackageManager } from '../../types/index.js';

export async function detectTestRunner(
  cwd: string,
): Promise<'jest' | 'vitest' | 'mocha' | 'none'> {
  try {
    const { default: fs } = await import('fs-extra');
    const { join } = await import('path');
    const pkg = (await fs.readJson(join(cwd, 'package.json'))) as {
      devDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.vitest) return 'vitest';
    if (deps.jest) return 'jest';
    if (deps.mocha) return 'mocha';
  } catch { /* ignore */ }
  return 'none';
}

export async function runUnitTests(
  cwd: string,
  pm: PackageManager,
  onOutput?: (line: string) => void,
): Promise<{ success: boolean; output: string; duration: number }> {
  const pmCmd = pm === 'unknown' ? 'npm' : pm;

  // Try 'test' script first
  const result = await spawnCommand(pmCmd, ['run', 'test', '--', '--passWithNoTests'], {
    cwd,
    onStdout: onOutput,
    onStderr: onOutput,
    timeout: 300_000,
  });

  return {
    success: result.exitCode === 0,
    output: result.stdout + result.stderr,
    duration: result.duration,
  };
}

export async function runTestsWithCoverage(
  cwd: string,
  pm: PackageManager,
  onOutput?: (line: string) => void,
): Promise<{ success: boolean; output: string; duration: number; coveragePath?: string }> {
  const pmCmd = pm === 'unknown' ? 'npm' : pm;

  const result = await spawnCommand(pmCmd, ['run', 'test:coverage'], {
    cwd,
    onStdout: onOutput,
    onStderr: onOutput,
    timeout: 300_000,
  });

  return {
    success: result.exitCode === 0,
    output: result.stdout + result.stderr,
    duration: result.duration,
  };
}

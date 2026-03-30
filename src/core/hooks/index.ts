/**
 * Deterministic Policy Hooks
 *
 * Pre/post action enforcement that runs around tool execution.
 * These are NOT event-driven hooks — they are deterministic gates
 * that block or modify actions before they reach disk.
 *
 * Hook types:
 *   - preWrite:   Runs before any file write. Can block or modify.
 *   - postWrite:  Runs after a file write. Can trigger lint/format.
 *   - preCommand: Runs before any shell command. Can block.
 *   - postExecute: Runs after all subtasks complete. Enforces invariants.
 *
 * Usage:
 *   const hooks = createHooks(config, projectPath);
 *   const blocked = await hooks.preWrite(filePath, content);
 *   if (blocked) return { output: blocked.reason, isError: true };
 */

import { resolve, relative, extname } from 'path';
import fs from 'fs-extra';
import type { MaikerConfig } from '../../types/index.js';
import { runCommand } from '../../tools/shell/index.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HookResult {
  blocked: boolean;
  reason?: string;
  /** For postWrite: modified content (e.g., after formatting) */
  modifiedContent?: string;
}

export interface PolicyHooks {
  /** Check before writing a file. Returns block reason or null. */
  preWrite(filePath: string, content: string): Promise<HookResult>;
  /** Run after writing a file. Can trigger formatting, linting. */
  postWrite(filePath: string): Promise<HookResult>;
  /** Check before running a command. Returns block reason or null. */
  preCommand(command: string): Promise<HookResult>;
  /** Run after all subtasks in a wave complete. Enforces invariants. */
  postExecute(changedFiles: string[]): Promise<PostExecuteResult>;
}

export interface PostExecuteResult {
  passed: boolean;
  violations: string[];
}

// ─── Secret Patterns ─────────────────────────────────────────────────────────

const SECRET_PATTERNS = [
  // API keys
  /(?:api[_-]?key|apikey)\s*[:=]\s*['"][A-Za-z0-9_\-]{20,}['"]/i,
  // AWS keys
  /AKIA[0-9A-Z]{16}/,
  // Generic tokens
  /(?:secret|token|password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}['"]/i,
  // Private keys
  /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/,
  // JWT tokens
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  // GitHub tokens
  /gh[ps]_[A-Za-z0-9]{36,}/,
  // Anthropic keys
  /sk-ant-[A-Za-z0-9_-]{20,}/,
  // OpenAI keys
  /sk-[A-Za-z0-9]{20,}T3BlbkFJ/,
];

// ─── No-Touch Zone Enforcement ───────────────────────────────────────────────

/**
 * Hard enforcement of no-touch zones.
 * Unlike the prompt-based instruction, this actually blocks writes.
 */
function checkNoTouchZones(
  filePath: string,
  projectPath: string,
  noTouchZones: string[],
): HookResult {
  const rel = relative(projectPath, resolve(projectPath, filePath));

  for (const zone of noTouchZones) {
    // Support glob-like matching: "src/legacy/" matches anything under it
    const normalizedZone = zone.replace(/\/$/, '');
    if (rel === normalizedZone || rel.startsWith(normalizedZone + '/')) {
      return {
        blocked: true,
        reason: `No-touch zone violation: ${rel} is in protected zone "${zone}"`,
      };
    }
  }
  return { blocked: false };
}

// ─── Secret Scanning ─────────────────────────────────────────────────────────

function scanForSecrets(content: string, filePath: string): HookResult {
  // Skip binary-looking files and common false-positive files
  const ext = extname(filePath).toLowerCase();
  const skipExts = ['.lock', '.svg', '.png', '.jpg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.map'];
  // Skip lock files specifically (package-lock.json, yarn.lock, etc.)
  const baseName = filePath.split('/').pop() ?? '';
  if (baseName.includes('lock') && (baseName.endsWith('.json') || baseName.endsWith('.yaml'))) {
    return { blocked: false };
  }
  if (skipExts.includes(ext)) return { blocked: false };

  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(content)) {
      return {
        blocked: true,
        reason: `Secret detected in ${filePath}: content matches pattern ${pattern.source.slice(0, 40)}...`,
      };
    }
  }
  return { blocked: false };
}

// ─── Format/Lint Hooks ───────────────────────────────────────────────────────

async function detectFormatter(projectPath: string): Promise<string | null> {
  const pkgPath = resolve(projectPath, 'package.json');
  if (!await fs.pathExists(pkgPath)) return null;

  try {
    const pkg = await fs.readJson(pkgPath) as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (allDeps['biome'] || allDeps['@biomejs/biome']) return 'biome';
    if (allDeps['prettier']) return 'prettier';
    return null;
  } catch {
    return null;
  }
}

async function formatFile(
  filePath: string,
  projectPath: string,
  formatter: string | null,
): Promise<void> {
  if (!formatter) return;

  const rel = relative(projectPath, filePath);
  const ext = extname(filePath).toLowerCase();
  const formattableExts = ['.ts', '.tsx', '.js', '.jsx', '.json', '.css', '.scss', '.md', '.html'];
  if (!formattableExts.includes(ext)) return;

  try {
    switch (formatter) {
      case 'prettier':
        await runCommand('npx', ['prettier', '--write', rel], { cwd: projectPath, timeout: 10_000 });
        break;
      case 'biome':
        await runCommand('npx', ['biome', 'format', '--write', rel], { cwd: projectPath, timeout: 10_000 });
        break;
    }
  } catch {
    // Formatting failure is non-fatal — log but don't block
  }
}

// ─── Changed File Inventory Validation ───────────────────────────────────────

async function validateChangedFiles(
  changedFiles: string[],
  projectPath: string,
  noTouchZones: string[],
): Promise<PostExecuteResult> {
  const violations: string[] = [];

  for (const file of changedFiles) {
    const rel = relative(projectPath, resolve(projectPath, file));

    // Check no-touch zones
    for (const zone of noTouchZones) {
      const normalizedZone = zone.replace(/\/$/, '');
      if (rel === normalizedZone || rel.startsWith(normalizedZone + '/')) {
        violations.push(`No-touch zone violated: ${rel} (zone: ${zone})`);
      }
    }

    // Check if file exists (it should after execution)
    const fullPath = resolve(projectPath, file);
    if (await fs.pathExists(fullPath)) {
      const content = await fs.readFile(fullPath, 'utf-8');
      const secretCheck = scanForSecrets(content, file);
      if (secretCheck.blocked) {
        violations.push(secretCheck.reason!);
      }
    }
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}

// ─── Hook Factory ────────────────────────────────────────────────────────────

let _cachedFormatter: string | null | undefined;

export function createHooks(
  config: MaikerConfig,
  projectPath: string,
  noTouchZones: string[] = [],
): PolicyHooks {
  return {
    async preWrite(filePath: string, content: string): Promise<HookResult> {
      // 1. No-touch zone enforcement
      const zoneCheck = checkNoTouchZones(filePath, projectPath, noTouchZones);
      if (zoneCheck.blocked) return zoneCheck;

      // 2. Secret scanning
      const secretCheck = scanForSecrets(content, filePath);
      if (secretCheck.blocked) return secretCheck;

      return { blocked: false };
    },

    async postWrite(filePath: string): Promise<HookResult> {
      // Auto-format written files if a formatter is detected
      if (_cachedFormatter === undefined) {
        _cachedFormatter = await detectFormatter(projectPath);
      }
      if (_cachedFormatter) {
        await formatFile(filePath, projectPath, _cachedFormatter);
      }
      return { blocked: false };
    },

    async preCommand(command: string): Promise<HookResult> {
      // Additional command-level policy checks can go here
      // (The guards module handles the base allow/deny lists)
      return { blocked: false };
    },

    async postExecute(changedFiles: string[]): Promise<PostExecuteResult> {
      return validateChangedFiles(changedFiles, projectPath, noTouchZones);
    },
  };
}

// ─── Convenience export for testing ──────────────────────────────────────────

export { checkNoTouchZones, scanForSecrets, SECRET_PATTERNS };

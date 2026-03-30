/**
 * Source-to-Test File Mapping
 *
 * Convention-based mapping from changed source files to their corresponding
 * test files. Used for selective test reruns after repair — only run tests
 * that are likely affected by the changed code.
 *
 * Supported conventions:
 *   foo.ts         → foo.test.ts, foo.spec.ts
 *   foo.tsx        → foo.test.tsx, foo.spec.tsx
 *   src/Button.tsx → src/Button.test.tsx, src/__tests__/Button.test.tsx
 *   src/utils.ts   → tests/utils.test.ts, test/utils.test.ts
 */

import { existsSync } from 'fs';
import { resolve, dirname, basename, extname, join } from 'path';

// ─── Test File Candidate Generation ──────────────────────────────────────────

/**
 * Generate candidate test file paths for a given source file.
 * Returns paths in priority order (most likely match first).
 */
export function getTestCandidates(sourcePath: string): string[] {
  const dir = dirname(sourcePath);
  const ext = extname(sourcePath);
  const base = basename(sourcePath, ext);

  // Skip files that are already test files
  if (base.endsWith('.test') || base.endsWith('.spec') || dir.includes('__tests__')) {
    return [sourcePath]; // The test file itself
  }

  const testExts = ext === '.tsx' ? ['.test.tsx', '.spec.tsx', '.test.ts', '.spec.ts']
    : ext === '.jsx' ? ['.test.jsx', '.spec.jsx', '.test.js', '.spec.js']
    : ext === '.ts' ? ['.test.ts', '.spec.ts']
    : ext === '.js' ? ['.test.js', '.spec.js']
    : [`.test${ext}`, `.spec${ext}`];

  const candidates: string[] = [];

  for (const testExt of testExts) {
    // Same directory: foo.test.ts
    candidates.push(join(dir, `${base}${testExt}`));

    // __tests__ subdirectory: __tests__/foo.test.ts
    candidates.push(join(dir, '__tests__', `${base}${testExt}`));
  }

  // Common alternative test directories (relative to project root)
  const pathParts = dir.split('/');
  const srcIndex = pathParts.indexOf('src');
  if (srcIndex >= 0) {
    const relPath = pathParts.slice(srcIndex + 1).join('/');
    for (const testExt of testExts) {
      // tests/components/foo.test.ts (mirror of src/components/foo.ts)
      candidates.push(join(...pathParts.slice(0, srcIndex), 'tests', relPath, `${base}${testExt}`));
      candidates.push(join(...pathParts.slice(0, srcIndex), 'test', relPath, `${base}${testExt}`));
      // __tests__ at project root level
      candidates.push(join(...pathParts.slice(0, srcIndex), '__tests__', relPath, `${base}${testExt}`));
    }
  }

  return candidates;
}

// ─── Resolve Affected Tests ──────────────────────────────────────────────────

/**
 * Given a list of changed source files, find the test files that should be re-run.
 * Checks each candidate path for existence.
 */
export function resolveAffectedTests(
  changedFiles: string[],
  projectPath: string,
): string[] {
  const testFiles = new Set<string>();

  for (const file of changedFiles) {
    const absFile = resolve(projectPath, file);
    const candidates = getTestCandidates(absFile);

    for (const candidate of candidates) {
      const absCandidate = resolve(projectPath, candidate);
      if (existsSync(absCandidate)) {
        // Return relative path for the test runner
        const relPath = absCandidate.startsWith(projectPath)
          ? absCandidate.slice(projectPath.length + 1)
          : absCandidate;
        testFiles.add(relPath);
      }
    }
  }

  return [...testFiles];
}

/**
 * Build a regex pattern for test runner --testPathPattern from affected test files.
 * Works with jest, vitest, and similar runners.
 */
export function buildTestPattern(testFiles: string[]): string | null {
  if (testFiles.length === 0) return null;

  // Escape special regex characters in file paths
  const escaped = testFiles.map(f =>
    f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  );

  return escaped.join('|');
}

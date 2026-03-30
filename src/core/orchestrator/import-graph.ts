/**
 * Lightweight TS/JS Import Graph
 *
 * Regex-based import parser for detecting shared dependencies between
 * parallel subtasks. Not a full AST — covers the common 95% of imports:
 *   - import ... from '...'
 *   - import('...')
 *   - require('...')
 *   - export ... from '...'
 *
 * Used by detectFileConflicts() to find when two subtasks modify files
 * that import from each other (shared dependency conflict).
 */

import { readFile } from 'fs/promises';
import { resolve, dirname, extname } from 'path';
import { existsSync } from 'fs';

// ─── Import Extraction ───────────────────────────────────────────────────────

const IMPORT_PATTERNS = [
  // import ... from '...' or import ... from "..."
  /(?:import|export)\s+.*?\s+from\s+['"]([^'"]+)['"]/g,
  // import '...' (side-effect imports)
  /import\s+['"]([^'"]+)['"]/g,
  // import('...')  (dynamic imports)
  /import\(\s*['"]([^'"]+)['"]\s*\)/g,
  // require('...')
  /require\(\s*['"]([^'"]+)['"]\s*\)/g,
  // export ... from '...'
  /export\s+\*\s+from\s+['"]([^'"]+)['"]/g,
];

/**
 * Extract import specifiers from a source file.
 * Returns only relative imports (starting with . or ..) — ignores node_modules packages.
 */
export function extractImports(source: string): string[] {
  const imports = new Set<string>();

  for (const pattern of IMPORT_PATTERNS) {
    // Reset lastIndex for global regex
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const specifier = match[1];
      // Only track relative imports — package imports aren't file conflicts
      if (specifier.startsWith('.')) {
        imports.add(specifier);
      }
    }
  }

  return [...imports];
}

/**
 * Resolve a relative import specifier to an absolute file path.
 * Tries common extensions (.ts, .tsx, .js, .jsx, /index.ts, /index.js).
 */
export function resolveImport(specifier: string, fromFile: string, projectPath: string): string | null {
  const fromDir = dirname(fromFile);
  const basePath = resolve(fromDir, specifier);

  // Try exact path first
  if (existsSync(basePath) && !existsSync(basePath + '/')) {
    return basePath;
  }

  // Try common extensions
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs'];
  for (const ext of extensions) {
    const withExt = basePath + ext;
    if (existsSync(withExt)) return withExt;
  }

  // Try as directory with index file
  for (const ext of extensions) {
    const indexFile = resolve(basePath, `index${ext}`);
    if (existsSync(indexFile)) return indexFile;
  }

  return null;
}

// ─── Import Graph ────────────────────────────────────────────────────────────

export interface ImportGraph {
  /** Map from absolute file path → set of absolute paths it imports */
  edges: Map<string, Set<string>>;
}

/**
 * Build a one-hop import graph for a set of files.
 * Only resolves imports between the given files — doesn't crawl the whole repo.
 */
export async function buildImportGraph(
  files: string[],
  projectPath: string,
): Promise<ImportGraph> {
  const graph: ImportGraph = { edges: new Map() };
  const absoluteFiles = new Set(files.map(f => resolve(projectPath, f)));

  for (const file of absoluteFiles) {
    try {
      const ext = extname(file).toLowerCase();
      if (!['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs'].includes(ext)) continue;

      const source = await readFile(file, 'utf-8');
      const imports = extractImports(source);
      const resolved = new Set<string>();

      for (const specifier of imports) {
        const target = resolveImport(specifier, file, projectPath);
        if (target) {
          resolved.add(target);
        }
      }

      graph.edges.set(file, resolved);
    } catch {
      // File doesn't exist or can't be read — skip
    }
  }

  return graph;
}

// ─── Conflict Detection ──────────────────────────────────────────────────────

/**
 * Detect import-level conflicts between subtasks in a wave.
 * Two subtasks conflict if:
 *   1. Subtask A modifies file X, subtask B modifies file Y
 *   2. X imports Y, OR Y imports X
 *
 * Returns pairs of conflicting subtask IDs.
 */
export async function findImportConflicts(
  wave: Array<{ id: string; fileTargets: string[] }>,
  projectPath: string,
): Promise<Array<[string, string]>> {
  if (wave.length <= 1) return [];

  // Collect all files across all subtasks
  const allFiles = wave.flatMap(s => s.fileTargets);
  if (allFiles.length === 0) return [];

  // Build import graph
  const graph = await buildImportGraph(allFiles, projectPath);

  const conflicts: Array<[string, string]> = [];

  for (let i = 0; i < wave.length; i++) {
    for (let j = i + 1; j < wave.length; j++) {
      const filesI = new Set(wave[i].fileTargets.map(f => resolve(projectPath, f)));
      const filesJ = new Set(wave[j].fileTargets.map(f => resolve(projectPath, f)));

      // Check if any file in subtask I imports any file in subtask J (or vice versa)
      let hasConflict = false;

      for (const fileI of filesI) {
        const importsOfI = graph.edges.get(fileI);
        if (importsOfI) {
          for (const importTarget of importsOfI) {
            if (filesJ.has(importTarget)) {
              hasConflict = true;
              break;
            }
          }
        }
        if (hasConflict) break;
      }

      if (!hasConflict) {
        for (const fileJ of filesJ) {
          const importsOfJ = graph.edges.get(fileJ);
          if (importsOfJ) {
            for (const importTarget of importsOfJ) {
              if (filesI.has(importTarget)) {
                hasConflict = true;
                break;
              }
            }
          }
          if (hasConflict) break;
        }
      }

      if (hasConflict) {
        conflicts.push([wave[i].id, wave[j].id]);
      }
    }
  }

  return conflicts;
}

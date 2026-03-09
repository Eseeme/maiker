import fs from 'fs-extra';
import { join } from 'path';
import type {
  RepoInspection,
  Framework,
  PackageManager,
  TestFramework,
  TaskClassification,
  TaskType,
  RiskLevel,
} from '../../types/index.js';
import { findFiles } from '../../tools/filesystem/index.js';
import { detectPackageManager } from '../../tools/package/index.js';

// ─── Repo Inspector ───────────────────────────────────────────────────────────

export async function inspectRepo(projectPath: string): Promise<RepoInspection> {
  const root = projectPath;

  const packageManager = await detectPackageManager(root);
  const framework = await detectFramework(root);
  const testFramework = await detectTestFramework(root);
  const routes = await detectRoutes(root, framework);
  const hotspots = await detectHotspots(root, framework);

  let pkg: {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  } = {};
  try {
    pkg = await fs.readJson(join(root, 'package.json'));
  } catch { /* ignore */ }

  const allDeps = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  };

  const tsFiles = await findFiles(root, ['.ts', '.tsx']);
  const hasTypeScript = tsFiles.length > 0 || Boolean(allDeps.typescript);

  const hasLinting = Boolean(
    allDeps.eslint ||
      (await fs.pathExists(join(root, '.eslintrc.js'))) ||
      (await fs.pathExists(join(root, '.eslintrc.json'))) ||
      (await fs.pathExists(join(root, 'eslint.config.js'))),
  );

  const hasPlaywright =
    Boolean(allDeps['@playwright/test']) ||
    (await fs.pathExists(join(root, 'playwright.config.ts'))) ||
    (await fs.pathExists(join(root, 'playwright.config.js')));

  return {
    framework,
    packageManager,
    testFramework,
    routes,
    entryPoints: await detectEntryPoints(root, framework),
    hotspots,
    dependencies: allDeps,
    scripts: pkg.scripts ?? {},
    hasTypeScript,
    hasLinting,
    hasPlaywright,
  };
}

async function detectFramework(root: string): Promise<Framework> {
  try {
    const pkg = (await fs.readJson(join(root, 'package.json'))) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (deps['next']) return 'nextjs';
    if (deps['nuxt']) return 'nuxt';
    if (deps['@remix-run/node'] || deps['@remix-run/react']) return 'remix';
    if (deps['@angular/core']) return 'angular';
    if (deps['vue']) return 'vue';
    if (deps['svelte']) return 'svelte';
    if (deps['react']) return 'react';
    if (deps['fastify']) return 'fastify';
    if (deps['express']) return 'express';
  } catch { /* ignore */ }

  // Check for config files
  if (await fs.pathExists(join(root, 'next.config.js'))) return 'nextjs';
  if (await fs.pathExists(join(root, 'next.config.ts'))) return 'nextjs';
  if (await fs.pathExists(join(root, 'nuxt.config.ts'))) return 'nuxt';
  if (await fs.pathExists(join(root, 'remix.config.js'))) return 'remix';

  return 'unknown';
}

async function detectTestFramework(root: string): Promise<TestFramework> {
  try {
    const pkg = (await fs.readJson(join(root, 'package.json'))) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (deps['@playwright/test']) return 'playwright';
    if (deps.cypress) return 'cypress';
    if (deps.vitest) return 'vitest';
    if (deps.jest) return 'jest';
    if (deps.mocha) return 'mocha';
  } catch { /* ignore */ }

  if (await fs.pathExists(join(root, 'playwright.config.ts'))) return 'playwright';
  if (await fs.pathExists(join(root, 'jest.config.js'))) return 'jest';
  if (await fs.pathExists(join(root, 'vitest.config.ts'))) return 'vitest';

  return 'none';
}

async function detectRoutes(root: string, framework: Framework): Promise<string[]> {
  const routes: string[] = ['/'];

  if (framework === 'nextjs') {
    // Next.js app router
    const appDir = join(root, 'app');
    const pagesDir = join(root, 'pages');
    const srcAppDir = join(root, 'src', 'app');
    const srcPagesDir = join(root, 'src', 'pages');

    for (const dir of [appDir, srcAppDir]) {
      if (await fs.pathExists(dir)) {
        const found = await findFiles(dir, ['page.tsx', 'page.ts', 'page.jsx', 'page.js']);
        for (const f of found) {
          const rel = f.replace(dir, '').replace(/\/(page\.(tsx?|jsx?))$/, '');
          if (rel && !routes.includes(rel)) routes.push(rel || '/');
        }
      }
    }

    for (const dir of [pagesDir, srcPagesDir]) {
      if (await fs.pathExists(dir)) {
        const files = await findFiles(dir, ['.tsx', '.ts', '.jsx', '.js']);
        for (const f of files) {
          const rel = f
            .replace(dir, '')
            .replace(/\.(tsx?|jsx?)$/, '')
            .replace('/index', '');
          if (rel && !rel.startsWith('/_') && !routes.includes(rel)) {
            routes.push(rel);
          }
        }
      }
    }
  }

  return routes.slice(0, 20);
}

async function detectEntryPoints(
  root: string,
  _framework: Framework,
): Promise<string[]> {
  const candidates = [
    'src/app/layout.tsx',
    'src/app/page.tsx',
    'app/layout.tsx',
    'app/page.tsx',
    'pages/index.tsx',
    'src/pages/index.tsx',
    'src/main.tsx',
    'src/index.tsx',
    'src/App.tsx',
  ];
  const found: string[] = [];
  for (const c of candidates) {
    if (await fs.pathExists(join(root, c))) found.push(c);
  }
  return found;
}

async function detectHotspots(
  root: string,
  _framework: Framework,
): Promise<string[]> {
  const hotspots: string[] = [];
  const dirs = ['src/components', 'src/app', 'app', 'pages', 'src/pages'];
  for (const dir of dirs) {
    if (await fs.pathExists(join(root, dir))) {
      hotspots.push(dir);
    }
  }
  return hotspots;
}

// ─── Task Classifier ──────────────────────────────────────────────────────────

export function classifyTask(goal: string): TaskClassification {
  const lower = goal.toLowerCase();

  let taskType: TaskType = 'unknown';
  let riskLevel: RiskLevel = 'medium';

  if (
    lower.includes('mobile') ||
    lower.includes('responsive') ||
    lower.includes('viewport') ||
    lower.includes('breakpoint')
  ) {
    taskType = 'mobile-responsive-redesign';
    riskLevel = 'medium';
  } else if (
    lower.includes('upgrade') ||
    lower.includes('update') ||
    lower.includes('migrate') ||
    lower.includes('version')
  ) {
    taskType = 'framework-upgrade';
    riskLevel = 'high';
  } else if (
    lower.includes('fix') ||
    lower.includes('bug') ||
    lower.includes('repair') ||
    lower.includes('broken')
  ) {
    taskType = 'bugfix';
    riskLevel = 'low';
  } else if (
    lower.includes('add') ||
    lower.includes('implement') ||
    lower.includes('feature') ||
    lower.includes('new')
  ) {
    taskType = 'feature-work';
    riskLevel = 'medium';
  } else if (lower.includes('refactor') || lower.includes('cleanup')) {
    taskType = 'refactor';
    riskLevel = 'medium';
  }

  return {
    taskType,
    riskLevel,
    affectedAreas: [],
    noTouchZones: [],
    estimatedComplexity: riskLevel === 'high' ? 'complex' : 'moderate',
  };
}

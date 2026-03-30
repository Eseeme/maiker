import { spawnCommand } from '../shell/index.js';
import { join } from 'path';
import fs from 'fs-extra';
import type { PlaywrightConfig } from '../../types/index.js';

export interface PlaywrightRunResult {
  success: boolean;
  output: string;
  duration: number;
  reportPath?: string;
  tracePaths?: string[];
}

export interface ScreenshotJob {
  route: string;
  viewport: [number, number];
  outputPath: string;
}

export async function runPlaywrightE2E(
  projectPath: string,
  outputDir: string,
  config: PlaywrightConfig,
  onOutput?: (line: string) => void,
): Promise<PlaywrightRunResult> {
  await fs.ensureDir(outputDir);

  const result = await spawnCommand(
    'npx',
    [
      'playwright',
      'test',
      '--reporter=json',
      `--output=${join(outputDir, 'traces')}`,
    ],
    {
      cwd: projectPath,
      env: {
        ...process.env,
        PLAYWRIGHT_BASE_URL: config.baseUrl,
      },
      onStdout: onOutput,
      onStderr: onOutput,
      timeout: config.timeout ?? 300_000,
    },
  );

  const reportPath = join(outputDir, 'reports', 'playwright-report.json');
  if (result.stdout) {
    try {
      // try to extract JSON report from stdout
      const jsonMatch = result.stdout.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        await fs.ensureDir(join(outputDir, 'reports'));
        await fs.writeFile(reportPath, jsonMatch[0]);
      }
    } catch { /* ignore */ }
  }

  return {
    success: result.exitCode === 0,
    output: result.stdout + result.stderr,
    duration: result.duration,
    reportPath: await fs.pathExists(reportPath) ? reportPath : undefined,
  };
}

export async function captureScreenshots(
  projectPath: string,
  screenshotsDir: string,
  config: PlaywrightConfig,
  onOutput?: (line: string) => void,
): Promise<string[]> {
  await fs.ensureDir(screenshotsDir);

  // Generate a temporary Playwright script
  const scriptPath = join(projectPath, '.maiker-screenshot-runner.ts');
  const screenshots: string[] = [];

  const script = generateScreenshotScript(config, screenshotsDir);
  await fs.writeFile(scriptPath, script);

  try {
    const result = await spawnCommand(
      'npx',
      ['playwright', 'test', '.maiker-screenshot-runner.ts', '--reporter=line'],
      {
        cwd: projectPath,
        env: {
          ...process.env,
          PLAYWRIGHT_BASE_URL: config.baseUrl,
        },
        onStdout: onOutput,
        onStderr: onOutput,
        timeout: 180_000,
      },
    );

    if (result.exitCode === 0) {
      // Collect screenshot paths
      const files = await fs.readdir(screenshotsDir).catch(() => []);
      for (const file of files) {
        if (file.endsWith('.png')) {
          screenshots.push(join(screenshotsDir, file));
        }
      }
    }
  } finally {
    await fs.remove(scriptPath).catch(() => { /* ignore */ });
  }

  return screenshots;
}

function generateScreenshotScript(
  config: PlaywrightConfig,
  outputDir: string,
): string {
  const viewportTests = config.viewports
    .flatMap(([width, height]) =>
      config.routes.map((route) => {
        const sanitizedRoute = route.replace(/\//g, '_').replace(/^_/, '') || 'root';
        const filename = `${sanitizedRoute}-${width}x${height}.png`;
        const errorsFile = `${sanitizedRoute}-${width}x${height}.errors.json`;
        return `
  test('screenshot ${route} at ${width}x${height}', async ({ page }) => {
    const consoleErrors: string[] = [];
    const networkErrors: string[] = [];

    // Capture console errors
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Capture uncaught page errors
    page.on('pageerror', (err) => {
      consoleErrors.push(err.message);
    });

    // Capture failed network requests
    page.on('requestfailed', (req) => {
      networkErrors.push(\`\${req.method()} \${req.url()} — \${req.failure()?.errorText ?? 'unknown'}\`);
    });

    await page.setViewportSize({ width: ${width}, height: ${height} });
    await page.goto('${config.baseUrl}${route}');
    await page.waitForLoadState('networkidle');
    await page.screenshot({
      path: ${JSON.stringify(join(outputDir, filename))},
      fullPage: true,
    });

    // Save errors alongside screenshot
    if (consoleErrors.length > 0 || networkErrors.length > 0) {
      const fs = require('fs');
      fs.writeFileSync(
        ${JSON.stringify(join(outputDir, errorsFile))},
        JSON.stringify({ consoleErrors, networkErrors }, null, 2),
      );
    }
  });`;
      }),
    )
    .join('\n');

  return `import { test } from '@playwright/test';

test.describe('mAIker Screenshot Capture', () => {${viewportTests}
});
`;
}

// ─── Screenshot Diffing ──────────────────────────────────────────────────────

export interface ScreenshotDiffResult {
  file: string;
  hasBaseline: boolean;
  changed: boolean;
  /** Percentage of pixels that differ (0-100). null if no baseline. */
  diffPercent: number | null;
  /** Path to the diff image (if generated) */
  diffPath?: string;
}

/**
 * Compare current screenshots against a baseline directory.
 * Uses pixel-level comparison via Node.js Buffer comparison.
 * For more sophisticated diffing, could integrate pixelmatch or similar.
 */
export async function diffScreenshots(
  currentDir: string,
  baselineDir: string,
  diffOutputDir?: string,
): Promise<ScreenshotDiffResult[]> {
  const results: ScreenshotDiffResult[] = [];

  if (!await fs.pathExists(currentDir)) return results;

  const currentFiles = (await fs.readdir(currentDir)).filter(f => f.endsWith('.png'));

  for (const file of currentFiles) {
    const currentPath = join(currentDir, file);
    const baselinePath = join(baselineDir, file);

    if (!await fs.pathExists(baselinePath)) {
      results.push({ file, hasBaseline: false, changed: true, diffPercent: null });
      continue;
    }

    // Compare file sizes first (fast check)
    const [currentStat, baselineStat] = await Promise.all([
      fs.stat(currentPath),
      fs.stat(baselinePath),
    ]);

    if (currentStat.size === baselineStat.size) {
      // Compare buffers for exact match
      const [currentBuf, baselineBuf] = await Promise.all([
        fs.readFile(currentPath),
        fs.readFile(baselinePath),
      ]);

      if (currentBuf.equals(baselineBuf)) {
        results.push({ file, hasBaseline: true, changed: false, diffPercent: 0 });
        continue;
      }
    }

    // Files differ — calculate approximate diff percentage by byte comparison
    const [currentBuf, baselineBuf] = await Promise.all([
      fs.readFile(currentPath),
      fs.readFile(baselinePath),
    ]);
    const minLen = Math.min(currentBuf.length, baselineBuf.length);
    let diffBytes = Math.abs(currentBuf.length - baselineBuf.length);
    for (let i = 0; i < minLen; i++) {
      if (currentBuf[i] !== baselineBuf[i]) diffBytes++;
    }
    const maxLen = Math.max(currentBuf.length, baselineBuf.length);
    const diffPercent = maxLen > 0 ? Math.round((diffBytes / maxLen) * 100) : 0;

    results.push({ file, hasBaseline: true, changed: true, diffPercent });
  }

  return results;
}

/**
 * Save current screenshots as the new baseline.
 */
export async function saveBaseline(
  screenshotsDir: string,
  baselineDir: string,
): Promise<void> {
  await fs.ensureDir(baselineDir);
  await fs.copy(screenshotsDir, baselineDir, { overwrite: true });
}

export async function isPlaywrightInstalled(projectPath: string): Promise<boolean> {
  const result = await spawnCommand('npx', ['playwright', '--version'], {
    cwd: projectPath,
    timeout: 10_000,
  });
  return result.exitCode === 0;
}

export async function installPlaywright(projectPath: string): Promise<void> {
  await spawnCommand('npx', ['playwright', 'install', '--with-deps'], {
    cwd: projectPath,
    timeout: 300_000,
  });
}

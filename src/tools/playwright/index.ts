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
        return `
  test('screenshot ${route} at ${width}x${height}', async ({ page }) => {
    await page.setViewportSize({ width: ${width}, height: ${height} });
    await page.goto('${config.baseUrl}${route}');
    await page.waitForLoadState('networkidle');
    await page.screenshot({
      path: ${JSON.stringify(join(outputDir, filename))},
      fullPage: true,
    });
  });`;
      }),
    )
    .join('\n');

  return `import { test } from '@playwright/test';

test.describe('mAIker Screenshot Capture', () => {${viewportTests}
});
`;
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

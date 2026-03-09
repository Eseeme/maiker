import type {
  ValidatorResult,
  VisualReviewAgentOutput,
  MaikerConfig,
  Issue,
} from '../../types/index.js';
import {
  runPlaywrightE2E,
  captureScreenshots,
  isPlaywrightInstalled,
} from '../../tools/playwright/index.js';
import { runVisualReviewAgent } from '../../agents/visual/index.js';
import { emitValidatorStarted, emitValidatorPassed, emitValidatorFailed, emitIssueCreated } from '../../artifacts/events.js';
import { getRunDir } from '../../core/state/index.js';
import { join } from 'path';

export interface VisualValidationOptions {
  runId: string;
  projectPath: string;
  config: MaikerConfig;
  taskConstraints: string[];
  baseDir?: string;
  onOutput?: (line: string) => void;
}

export interface VisualValidationResult {
  playwrightResult?: ValidatorResult;
  screenshotResult?: ValidatorResult;
  visualReviewResult?: ValidatorResult;
  issues: Issue[];
  screenshotPaths: string[];
}

export async function runVisualValidation(
  opts: VisualValidationOptions,
): Promise<VisualValidationResult> {
  const { runId, projectPath, config, taskConstraints, baseDir, onOutput } = opts;
  const runDir = getRunDir(runId, baseDir);
  const screenshotsDir = join(runDir, 'artifacts', 'screenshots');

  const issues: Issue[] = [];
  let screenshotPaths: string[] = [];
  let playwrightResult: ValidatorResult | undefined;
  let screenshotResult: ValidatorResult | undefined;
  let visualReviewResult: ValidatorResult | undefined;

  // 1. Check Playwright availability
  const playwrightAvailable = await isPlaywrightInstalled(projectPath);

  // 2. Run Playwright E2E
  if (config.validators.playwright_e2e && playwrightAvailable) {
    emitValidatorStarted(runId, 'playwright_e2e');
    const result = await runPlaywrightE2E(
      projectPath,
      join(runDir, 'artifacts'),
      config.playwright,
      onOutput,
    );
    playwrightResult = {
      name: 'playwright_e2e',
      status: result.success ? 'passed' : 'failed',
      duration: result.duration,
      output: result.output,
      error: result.success ? undefined : result.output,
      artifacts: result.reportPath ? [result.reportPath] : [],
    };
    if (result.success) emitValidatorPassed(runId, 'playwright_e2e');
    else emitValidatorFailed(runId, 'playwright_e2e', 1);
  }

  // 3. Capture screenshots
  if (config.validators.screenshot_capture && playwrightAvailable) {
    emitValidatorStarted(runId, 'screenshot_capture');
    try {
      screenshotPaths = await captureScreenshots(
        projectPath,
        screenshotsDir,
        config.playwright,
        onOutput,
      );
      screenshotResult = {
        name: 'screenshot_capture',
        status: 'passed',
        artifacts: screenshotPaths,
      };
      emitValidatorPassed(runId, 'screenshot_capture');
    } catch (err) {
      screenshotResult = {
        name: 'screenshot_capture',
        status: 'failed',
        error: String(err),
      };
      emitValidatorFailed(runId, 'screenshot_capture', 0);
    }
  }

  // 4. AI visual review
  if (config.validators.visual_review && screenshotPaths.length > 0) {
    emitValidatorStarted(runId, 'visual_review');
    try {
      const reviewOutput: VisualReviewAgentOutput = await runVisualReviewAgent(
        {
          runId,
          goal: '',
          projectPath,
          screenshotPaths,
          viewports: config.playwright.viewports.map(([w, h]) => `${w}x${h}`),
          taskConstraints,
          routeMetadata: Object.fromEntries(
            config.playwright.routes.map((r) => [r, r]),
          ),
        },
        config,
      );

      issues.push(...reviewOutput.issues);

      const hasHighIssues = reviewOutput.issues.some(
        (i) => i.severity === 'high' || i.severity === 'critical',
      );
      visualReviewResult = {
        name: 'visual_review',
        status: hasHighIssues ? 'failed' : 'passed',
        output: reviewOutput.summary,
      };

      for (const issue of reviewOutput.issues) {
        emitIssueCreated(runId, issue.id, issue.severity, 'VALIDATE_VISUAL');
      }

      if (hasHighIssues) {
        emitValidatorFailed(runId, 'visual_review', issues.length);
      } else {
        emitValidatorPassed(runId, 'visual_review');
      }
    } catch (err) {
      visualReviewResult = {
        name: 'visual_review',
        status: 'failed',
        error: String(err),
      };
      emitValidatorFailed(runId, 'visual_review', 0);
    }
  }

  return {
    playwrightResult,
    screenshotResult,
    visualReviewResult,
    issues,
    screenshotPaths,
  };
}

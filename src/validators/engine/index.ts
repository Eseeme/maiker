import type {
  ValidationProfile,
  ValidationResult,
  ValidatorResult,
  MaikerConfig,
  Issue,
} from '../../types/index.js';
import { runDeterministicValidators } from '../deterministic/index.js';
import { runVisualValidation } from '../visual/index.js';

export interface ValidationEngineOptions {
  runId: string;
  projectPath: string;
  profile: ValidationProfile;
  config: MaikerConfig;
  taskConstraints?: string[];
  baseDir?: string;
  onOutput?: (line: string) => void;
}

export interface FullValidationResult {
  deterministic: ValidationResult;
  visual?: {
    results: ValidatorResult[];
    issues: Issue[];
    screenshotPaths: string[];
  };
  overallPassed: boolean;
}

export async function runFullValidation(
  opts: ValidationEngineOptions,
): Promise<FullValidationResult> {
  const { runId, projectPath, profile, config, taskConstraints = [], baseDir, onOutput } = opts;

  const now = new Date().toISOString();

  // ── Deterministic validators ─────────────────────────────────────────────
  const deterministicValidators = profile.required.filter((v) =>
    [
      'install',
      'build',
      'lint',
      'typecheck',
      'unit_tests',
      'integration_tests',
      'regression_tests',
      'lockfile_sanity',
    ].includes(v),
  );

  const deterministicResults = await runDeterministicValidators({
    runId,
    projectPath,
    validators: deterministicValidators,
    config,
    onOutput,
  });

  const deterministicFailed = deterministicResults.filter(
    (r) => r.status === 'failed',
  );
  const deterministic: ValidationResult = {
    stage: 'deterministic',
    results: deterministicResults,
    passed: deterministicFailed.length === 0,
    failedCount: deterministicFailed.length,
    startedAt: now,
    completedAt: new Date().toISOString(),
  };

  // Stop if build failed and policy says so
  if (
    !deterministic.passed &&
    config.policies.stopOnBuildFailure &&
    deterministicResults.some((r) => r.name === 'build' && r.status === 'failed')
  ) {
    return {
      deterministic,
      overallPassed: false,
    };
  }

  // ── Visual validators ─────────────────────────────────────────────────────
  const needsVisual =
    profile.required.some((v) =>
      ['playwright_e2e', 'screenshot_capture', 'visual_review', 'ux_rules'].includes(v),
    );

  if (!needsVisual) {
    return {
      deterministic,
      overallPassed: deterministic.passed,
    };
  }

  const visualResult = await runVisualValidation({
    runId,
    projectPath,
    config,
    taskConstraints,
    baseDir,
    onOutput,
  });

  const visualResults: ValidatorResult[] = [
    visualResult.playwrightResult,
    visualResult.screenshotResult,
    visualResult.visualReviewResult,
  ].filter(Boolean) as ValidatorResult[];

  const visualPassed = visualResults.every(
    (r) => r.status === 'passed' || r.status === 'skipped',
  );

  return {
    deterministic,
    visual: {
      results: visualResults,
      issues: visualResult.issues,
      screenshotPaths: visualResult.screenshotPaths,
    },
    overallPassed: deterministic.passed && visualPassed,
  };
}

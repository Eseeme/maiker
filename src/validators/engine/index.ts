import type {
  ValidationProfile,
  ValidationResult,
  ValidatorResult,
  ValidatorName,
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
  /** Only re-run these validators (selective rerun after repair). If empty, runs all. */
  onlyValidators?: ValidatorName[];
  /** Previous validation results — used to skip passing validators on rerun */
  previousResults?: FullValidationResult;
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

// ─── Validator Dependency Graph ──────────────────────────────────────────────

/**
 * Defines which validators depend on others.
 * If a dependency failed, the dependent validator is skipped (no point running tests if build fails).
 */
const VALIDATOR_DEPS: Partial<Record<ValidatorName, ValidatorName[]>> = {
  lint: ['install'],
  typecheck: ['install'],
  build: ['install'],
  unit_tests: ['build'],
  integration_tests: ['build'],
  regression_tests: ['build'],
  playwright_e2e: ['build'],
  lockfile_sanity: ['install'],
};

/**
 * Order validators respecting dependencies (topological sort).
 * Validators whose deps failed are moved to a skip set.
 */
function orderValidators(
  validators: ValidatorName[],
  failedSet: Set<ValidatorName>,
): { ordered: ValidatorName[]; skippedDueToDeps: ValidatorName[] } {
  const ordered: ValidatorName[] = [];
  const skippedDueToDeps: ValidatorName[] = [];

  // Canonical execution order
  const ORDER: ValidatorName[] = [
    'install', 'build', 'lint', 'typecheck',
    'unit_tests', 'integration_tests', 'regression_tests',
    'lockfile_sanity', 'playwright_e2e',
    'screenshot_capture', 'visual_review', 'ux_rules',
    'accessibility', 'mobile_layout_rules',
  ];

  for (const v of ORDER) {
    if (!validators.includes(v)) continue;
    const deps = VALIDATOR_DEPS[v] ?? [];
    const depsOk = deps.every(d => !failedSet.has(d));
    if (depsOk) {
      ordered.push(v);
    } else {
      skippedDueToDeps.push(v);
    }
  }

  // Add any validators not in the canonical order
  for (const v of validators) {
    if (!ordered.includes(v) && !skippedDueToDeps.includes(v)) {
      ordered.push(v);
    }
  }

  return { ordered, skippedDueToDeps };
}

// ─── Main Validation Entry Point ─────────────────────────────────────────────

export async function runFullValidation(
  opts: ValidationEngineOptions,
): Promise<FullValidationResult> {
  const {
    runId, projectPath, profile, config,
    taskConstraints = [], baseDir, onOutput,
    onlyValidators, previousResults,
  } = opts;

  const now = new Date().toISOString();

  // ── Determine which validators to run ───────────────────────────────────
  let deterministicValidators = profile.required.filter((v) =>
    [
      'install', 'build', 'lint', 'typecheck',
      'unit_tests', 'integration_tests', 'regression_tests', 'lockfile_sanity',
    ].includes(v),
  );

  // Selective rerun: only run specified validators (after repair)
  if (onlyValidators && onlyValidators.length > 0) {
    deterministicValidators = deterministicValidators.filter(v => onlyValidators.includes(v));
    if (onOutput) {
      onOutput(`Selective rerun: ${deterministicValidators.join(', ')}`);
    }
  }

  // If we have previous results, skip validators that already passed
  // (unless they're in the onlyValidators list — those are explicitly requested)
  const previouslyPassed = new Set<ValidatorName>();
  if (previousResults && !onlyValidators) {
    for (const r of previousResults.deterministic.results) {
      if (r.status === 'passed') {
        previouslyPassed.add(r.name as ValidatorName);
      }
    }
    const before = deterministicValidators.length;
    deterministicValidators = deterministicValidators.filter(v => !previouslyPassed.has(v));
    if (before !== deterministicValidators.length && onOutput) {
      onOutput(`Skipping ${before - deterministicValidators.length} previously-passed validator(s)`);
    }
  }

  // ── Respect dependency graph ────────────────────────────────────────────
  // Track which validators have failed (from previous results or current run)
  const failedSet = new Set<ValidatorName>();
  if (previousResults) {
    for (const r of previousResults.deterministic.results) {
      if (r.status === 'failed') failedSet.add(r.name as ValidatorName);
    }
  }

  const { ordered, skippedDueToDeps } = orderValidators(deterministicValidators, failedSet);

  if (skippedDueToDeps.length > 0 && onOutput) {
    onOutput(`Skipping due to failed dependencies: ${skippedDueToDeps.join(', ')}`);
  }

  // ── Run deterministic validators ────────────────────────────────────────
  const deterministicResults = await runDeterministicValidators({
    runId,
    projectPath,
    validators: ordered,
    config,
    onOutput,
  });

  // Add skipped-due-to-deps results
  for (const v of skippedDueToDeps) {
    deterministicResults.push({
      name: v,
      status: 'skipped',
      duration: 0,
      output: 'Skipped: dependency validator failed',
    });
  }

  // Merge with previously-passed results for a complete picture
  const mergedResults = [...deterministicResults];
  if (previousResults) {
    for (const prev of previousResults.deterministic.results) {
      const alreadyInCurrent = mergedResults.some(r => r.name === prev.name);
      if (!alreadyInCurrent && prev.status === 'passed') {
        mergedResults.push({ ...prev, output: '(cached — passed on previous run)' });
      }
    }
  }

  const deterministicFailed = mergedResults.filter((r) => r.status === 'failed');
  const deterministic: ValidationResult = {
    stage: 'deterministic',
    results: mergedResults,
    passed: deterministicFailed.length === 0,
    failedCount: deterministicFailed.length,
    startedAt: now,
    completedAt: new Date().toISOString(),
  };

  // Stop if build failed and policy says so
  if (
    !deterministic.passed &&
    config.policies.stopOnBuildFailure &&
    mergedResults.some((r) => r.name === 'build' && r.status === 'failed')
  ) {
    return {
      deterministic,
      overallPassed: false,
    };
  }

  // ── Visual validators ───────────────────────────────────────────────────
  // Skip visual if selective rerun doesn't include visual validators
  if (onlyValidators && !onlyValidators.some(v =>
    ['playwright_e2e', 'screenshot_capture', 'visual_review', 'ux_rules'].includes(v),
  )) {
    return {
      deterministic,
      visual: previousResults?.visual, // Keep previous visual results
      overallPassed: deterministic.passed && (previousResults?.visual
        ? previousResults.visual.results.every(r => r.status === 'passed' || r.status === 'skipped')
        : true),
    };
  }

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

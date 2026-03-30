import type {
  PolicyConfig,
  TaskClassification,
  ValidationProfile,
  TaskType,
  ValidatorName,
} from '../../types/index.js';

// ─── Validation Profile Generator ────────────────────────────────────────────

const PROFILES: Record<TaskType, Omit<ValidationProfile, 'taskType'>> = {
  'mobile-responsive-redesign': {
    required: [
      'build',
      'lint',
      'typecheck',
      'playwright_e2e',
      'screenshot_capture',
      'visual_review',
      'ux_rules',
    ],
    optional: ['accessibility'],
    skipped: ['integration_tests'],
  },
  'framework-upgrade': {
    required: [
      'install',
      'build',
      'lint',
      'typecheck',
      'unit_tests',
      'integration_tests',
      'playwright_e2e',
      'lockfile_sanity',
    ],
    optional: ['screenshot_capture', 'visual_review'],
    skipped: ['mobile_layout_rules'],
  },
  'feature-work': {
    required: ['build', 'lint', 'typecheck', 'unit_tests', 'playwright_e2e'],
    optional: ['integration_tests', 'screenshot_capture', 'visual_review'],
    skipped: [],
  },
  bugfix: {
    required: ['build', 'lint', 'typecheck'],
    optional: ['unit_tests', 'playwright_e2e'],
    skipped: ['visual_review', 'screenshot_capture'],
  },
  refactor: {
    required: ['build', 'lint', 'typecheck', 'unit_tests'],
    optional: ['integration_tests'],
    skipped: ['visual_review', 'screenshot_capture'],
  },
  unknown: {
    required: ['build', 'lint', 'typecheck'],
    optional: ['unit_tests', 'playwright_e2e'],
    skipped: [],
  },
};

export function getValidationProfile(
  classification: TaskClassification,
): ValidationProfile {
  const profile = PROFILES[classification.taskType] ?? PROFILES.unknown;
  return {
    taskType: classification.taskType,
    ...profile,
  };
}

// ─── Retry Policy ─────────────────────────────────────────────────────────────

export function shouldEscalate(
  issueId: string,
  retryCounts: Record<string, number>,
  policy: PolicyConfig,
): boolean {
  const issueRetries = retryCounts[`issue:${issueId}`] ?? 0;
  // Only count issue-level retries for the total — exclude the 'run' key
  const totalRepairs = Object.entries(retryCounts)
    .filter(([key]) => key.startsWith('issue:'))
    .reduce((sum, [, count]) => sum + count, 0);

  return (
    issueRetries >= policy.maxAutoRepairsPerIssue ||
    totalRepairs >= policy.maxAutoRepairsPerRun
  );
}

/** Check if we should auto-replan instead of continuing repairs */
export function shouldAutoReplan(
  retryCounts: Record<string, number>,
  policy: PolicyConfig,
): boolean {
  // If we've used > 50% of the run budget without resolving anything, replan
  const totalRepairs = Object.entries(retryCounts)
    .filter(([key]) => key.startsWith('issue:'))
    .reduce((sum, [, count]) => sum + count, 0);
  return totalRepairs >= Math.ceil(policy.maxAutoRepairsPerRun / 2);
}

export function shouldContinueRepair(
  retryCounts: Record<string, number>,
  policy: PolicyConfig,
): boolean {
  const totalRepairs = Object.entries(retryCounts)
    .filter(([key]) => key.startsWith('issue:'))
    .reduce((sum, [, count]) => sum + count, 0);
  return totalRepairs < policy.maxAutoRepairsPerRun;
}

export function getRepairCount(
  issueId: string,
  retryCounts: Record<string, number>,
): number {
  return retryCounts[`issue:${issueId}`] ?? 0;
}

// ─── Repair Strategy Escalation ──────────────────────────────────────────────

export type RepairStrategy =
  | 'local_fix'       // Attempt 1: minimal patch targeting the exact error
  | 'root_cause'      // Attempt 2: broader analysis, trace the error to its source
  | 'partial_replan'  // Attempt 3: rethink the approach for this specific issue
  | 'alternate_model' // Attempt 4: try a different model for a fresh perspective
  | 'escalate';       // Beyond budget: hand off to human

export interface RepairStrategyConfig {
  strategy: RepairStrategy;
  /** System prompt modifier for this strategy */
  strategyPrompt: string;
  /** If alternate_model, which model config key to use */
  alternateModelKey?: keyof import('../../types/index.js').MaikerConfig['models'];
  /** Higher temperature for more creative attempts */
  temperature?: number;
}

/** Context for smarter repair strategy selection */
export interface RepairContext {
  attemptNumber: number;
  /** Primary error category from the failing validators */
  errorCategory?: 'build' | 'lint' | 'type' | 'test' | 'other';
  /** Number of files involved in the repair */
  fileCount?: number;
  /** Number of failures in the previous validation run */
  previousFailureCount?: number;
  /** Number of failures in the current validation run */
  currentFailureCount?: number;
}

/**
 * Determine the repair strategy based on attempt number AND error context.
 * Category-aware: lint errors get different treatment than build errors.
 * Progress-aware: if failures are decreasing, stay on the current strategy.
 */
export function getRepairStrategy(attemptNumber: number, ctx?: RepairContext): RepairStrategyConfig {
  // Progress detection: if the current strategy is reducing failures, repeat it
  if (ctx && ctx.previousFailureCount !== undefined && ctx.currentFailureCount !== undefined) {
    if (ctx.currentFailureCount < ctx.previousFailureCount && attemptNumber > 1) {
      // Current strategy is making progress — repeat instead of escalating
      return getRepairStrategy(attemptNumber - 1, { ...ctx, previousFailureCount: undefined });
    }
  }

  // Category-specific strategy adjustments
  if (ctx?.errorCategory === 'lint' && attemptNumber <= 2) {
    // Lint errors are almost always surface-level — stay on local_fix longer
    return {
      strategy: 'local_fix',
      strategyPrompt: `STRATEGY: LOCAL FIX — LINT (Attempt ${attemptNumber})
This is a lint/formatting error. These are almost always surface-level fixes.
Read the exact lint error, find the line, and apply a minimal targeted fix.
Do NOT refactor or redesign — just satisfy the lint rule.
If the lint rule seems wrong, check if there's an eslint-disable comment or config change needed.`,
    };
  }

  if (ctx?.errorCategory === 'build' && attemptNumber === 1) {
    // Build errors often have upstream causes — go straight to root cause
    return {
      strategy: 'root_cause',
      strategyPrompt: `STRATEGY: ROOT CAUSE — BUILD (Attempt 1)
Build errors are rarely surface-level. Before patching, analyze:
1. Is a dependency missing? Check imports and package.json.
2. Is a type definition wrong? Check the full type chain.
3. Is a generated file out of date?
4. Read the full error output — the real cause is often earlier in the log.`,
      temperature: 0.2,
    };
  }

  if (ctx?.errorCategory === 'type' && ctx.fileCount && ctx.fileCount > 5) {
    // Many-file type errors often need broader analysis from attempt 1
    return {
      strategy: 'root_cause',
      strategyPrompt: `STRATEGY: ROOT CAUSE — TYPE ERRORS (${ctx.fileCount} files)
Multiple type errors across many files usually indicate a wrong type signature
or missing type export upstream. Do NOT fix each file individually.
Find the ROOT type definition that changed and fix it there.
The individual errors should resolve once the source type is correct.`,
      temperature: 0.2,
    };
  }
  switch (attemptNumber) {
    case 1:
      return {
        strategy: 'local_fix',
        strategyPrompt: `STRATEGY: LOCAL FIX (Attempt 1)
Apply the smallest possible patch directly at the error location.
Do NOT change the overall approach — just fix the specific failing line/function.
Read the error output carefully and make a targeted, surgical fix.`,
      };

    case 2:
      return {
        strategy: 'root_cause',
        strategyPrompt: `STRATEGY: ROOT CAUSE ANALYSIS (Attempt 2)
The previous local fix did not resolve the issue. Step back and analyze:
1. What is the ACTUAL root cause? (not just the symptom)
2. Is the error caused by something upstream? A wrong assumption? A missing dependency?
3. Read more files to understand the full context before changing anything.
4. The fix may need to be in a DIFFERENT file than where the error appears.
Think deeper — do not repeat the previous approach.`,
        temperature: 0.3,
      };

    case 3:
      return {
        strategy: 'partial_replan',
        strategyPrompt: `STRATEGY: PARTIAL REPLAN (Attempt 3)
Two previous repair attempts failed. The original implementation approach for this issue may be flawed.
Consider:
1. Is there a fundamentally different way to implement this?
2. Should you undo the previous changes and take a different path?
3. Are there simpler alternatives that avoid the problem entirely?
4. Check if the acceptance criteria can be met with a different design.
Be willing to rewrite, not just patch.`,
        temperature: 0.5,
      };

    case 4:
      return {
        strategy: 'alternate_model',
        strategyPrompt: `STRATEGY: FRESH PERSPECTIVE (Attempt 4)
Three previous repair attempts by another model have all failed. You are a fresh set of eyes.
The previous approaches were:
- Attempt 1: Local fix at the error location — FAILED
- Attempt 2: Root cause analysis — FAILED
- Attempt 3: Partial replan/rewrite — FAILED

Take a completely different approach. Question every assumption.
Read the original goal and acceptance criteria first, then the failing code.
Consider whether the entire subtask needs a different implementation strategy.`,
        // Pick alternate model based on provider diversity — use a different
        // provider than the primary repair agent for a genuinely fresh perspective.
        // Preference: planner (reasoning-focused), then visualReview (if multimodal
        // could help), then codeGeneration (same role but potentially different model).
        alternateModelKey: 'planner',
        temperature: 0.4,
      };

    default:
      return {
        strategy: 'escalate',
        strategyPrompt: 'Maximum repair attempts exceeded. Escalating to human review.',
      };
  }
}

// ─── Structured Repair History ───────────────────────────────────────────────

export interface RepairAttemptRecord {
  attemptNumber: number;
  strategy: RepairStrategy;
  issueId: string;
  patchPlan: string;
  changedFiles: string[];
  outcome: 'resolved' | 'still_failing' | 'new_errors';
  /** What specifically was tried */
  description: string;
}

/**
 * Format structured repair history for the repair agent prompt.
 * Provides clear, actionable context about what was tried and why it failed.
 */
export function formatRepairHistory(history: RepairAttemptRecord[]): string {
  if (history.length === 0) return 'No prior attempts.';

  return history.map(h =>
    `[Attempt ${h.attemptNumber}] Strategy: ${h.strategy}
  Issue: ${h.issueId}
  Plan: ${h.patchPlan}
  Changed: ${h.changedFiles.join(', ') || 'none'}
  Outcome: ${h.outcome}
  Details: ${h.description}`
  ).join('\n\n');
}

// ─── Context Impact Analysis ──────────────────────────────────────────────────

export function analyseContextImpact(
  message: string,
  currentStage: string,
): 'low' | 'medium' | 'high' {
  const lower = message.toLowerCase();

  // High impact — affects plan or constraints (word-boundary matching)
  if (
    /\bdo not\b/.test(lower) ||
    /\bdon't\b/.test(lower) ||
    /\bnever\b/.test(lower) ||
    /\breplan\b/.test(lower) ||
    /\bchange the approach\b/.test(lower) ||
    /\bstart over\b/.test(lower)
  ) {
    return 'high';
  }

  // Medium impact — affects current stage or implementation (word-boundary matching)
  if (
    /\balso\b/.test(lower) ||
    /\badditionally\b/.test(lower) ||
    /\bmake sure\b/.test(lower) ||
    /\bremember to\b/.test(lower) ||
    /\bimportant:/.test(lower)
  ) {
    return 'medium';
  }

  return 'low';
}

// ─── Enabled Validators (from profile + config intersection) ──────────────────

export function resolveValidators(
  profile: ValidationProfile,
  configEnabled: Record<ValidatorName, boolean>,
): ValidatorName[] {
  return profile.required.filter(
    (v) => configEnabled[v] !== false,
  );
}

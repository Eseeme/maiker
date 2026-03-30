import { describe, it, expect } from 'vitest';
import {
  shouldEscalate,
  shouldAutoReplan,
  shouldContinueRepair,
  getRepairCount,
  getValidationProfile,
  analyseContextImpact,
  getRepairStrategy,
  formatRepairHistory,
} from '../src/core/policies/index.js';
import type { PolicyConfig, TaskClassification } from '../src/types/index.js';

const defaultPolicy: PolicyConfig = {
  requireHumanApproval: true,
  postApprovalReviewRequired: true,
  maxAutoRepairsPerIssue: 3,
  maxAutoRepairsPerRun: 6,
  maxVisualRetries: 2,
  stopOnBuildFailure: false,
  security: {
    mode: 'workspace',
    protectedFiles: [],
    allowedCommands: [],
    blockedCommands: [],
  },
};

describe('shouldEscalate', () => {
  it('returns false when retries are below limits', () => {
    const counts = { 'issue:bug-1': 1, run: 1 };
    expect(shouldEscalate('bug-1', counts, defaultPolicy)).toBe(false);
  });

  it('returns true when issue retries hit per-issue limit', () => {
    const counts = { 'issue:bug-1': 3, run: 3 };
    expect(shouldEscalate('bug-1', counts, defaultPolicy)).toBe(true);
  });

  it('returns true when total repairs hit run limit', () => {
    const counts = { 'issue:bug-1': 2, 'issue:bug-2': 2, 'issue:bug-3': 2, run: 6 };
    expect(shouldEscalate('bug-1', counts, defaultPolicy)).toBe(true);
  });

  it('returns false for unknown issue', () => {
    const counts = { run: 0 };
    expect(shouldEscalate('nonexistent', counts, defaultPolicy)).toBe(false);
  });

  it('ignores the "run" key in total count', () => {
    const counts = { run: 100, 'issue:bug-1': 1 };
    expect(shouldEscalate('bug-1', counts, defaultPolicy)).toBe(false);
  });
});

describe('shouldAutoReplan', () => {
  it('returns false when below half budget', () => {
    const counts = { 'issue:bug-1': 1, 'issue:bug-2': 1, run: 2 };
    expect(shouldAutoReplan(counts, defaultPolicy)).toBe(false);
  });

  it('returns true when at half budget', () => {
    // maxAutoRepairsPerRun=6, half=3
    const counts = { 'issue:bug-1': 2, 'issue:bug-2': 1, run: 3 };
    expect(shouldAutoReplan(counts, defaultPolicy)).toBe(true);
  });
});

describe('shouldContinueRepair', () => {
  it('returns true when budget remains', () => {
    const counts = { 'issue:bug-1': 2, run: 2 };
    expect(shouldContinueRepair(counts, defaultPolicy)).toBe(true);
  });

  it('returns false when budget exhausted', () => {
    const counts = { 'issue:bug-1': 3, 'issue:bug-2': 3, run: 6 };
    expect(shouldContinueRepair(counts, defaultPolicy)).toBe(false);
  });
});

describe('getRepairCount', () => {
  it('returns count for existing issue', () => {
    expect(getRepairCount('bug-1', { 'issue:bug-1': 5 })).toBe(5);
  });

  it('returns 0 for missing issue', () => {
    expect(getRepairCount('bug-2', { 'issue:bug-1': 5 })).toBe(0);
  });
});

describe('getValidationProfile', () => {
  it('returns mobile-responsive profile', () => {
    const classification: TaskClassification = {
      taskType: 'mobile-responsive-redesign',
      riskLevel: 'medium',
      affectedAreas: ['layout'],
      noTouchZones: [],
      estimatedComplexity: 'moderate',
    };
    const profile = getValidationProfile(classification);
    expect(profile.taskType).toBe('mobile-responsive-redesign');
    expect(profile.required).toContain('visual_review');
    expect(profile.required).toContain('screenshot_capture');
    expect(profile.required).toContain('playwright_e2e');
  });

  it('returns bugfix profile with minimal validators', () => {
    const classification: TaskClassification = {
      taskType: 'bugfix',
      riskLevel: 'low',
      affectedAreas: ['button'],
      noTouchZones: [],
      estimatedComplexity: 'simple',
    };
    const profile = getValidationProfile(classification);
    expect(profile.required).toContain('build');
    expect(profile.required).toContain('typecheck');
    expect(profile.skipped).toContain('visual_review');
  });

  it('returns framework-upgrade profile with install check', () => {
    const classification: TaskClassification = {
      taskType: 'framework-upgrade',
      riskLevel: 'high',
      affectedAreas: ['all'],
      noTouchZones: [],
      estimatedComplexity: 'complex',
    };
    const profile = getValidationProfile(classification);
    expect(profile.required).toContain('install');
    expect(profile.required).toContain('lockfile_sanity');
  });

  it('falls back to unknown profile for unrecognized task type', () => {
    const classification: TaskClassification = {
      taskType: 'unknown',
      riskLevel: 'low',
      affectedAreas: [],
      noTouchZones: [],
      estimatedComplexity: 'simple',
    };
    const profile = getValidationProfile(classification);
    expect(profile.required).toContain('build');
    expect(profile.required).toContain('typecheck');
  });
});

describe('analyseContextImpact', () => {
  it('returns high for prohibitive language', () => {
    expect(analyseContextImpact('Do not modify the header', 'EXECUTE')).toBe('high');
    expect(analyseContextImpact("Don't touch the sidebar", 'EXECUTE')).toBe('high');
    expect(analyseContextImpact('Never change the auth module', 'PLAN')).toBe('high');
    expect(analyseContextImpact('Please replan everything', 'REPAIR')).toBe('high');
  });

  it('returns medium for additive context', () => {
    expect(analyseContextImpact('Also add a loading spinner', 'EXECUTE')).toBe('medium');
    expect(analyseContextImpact('Make sure the tests pass', 'VALIDATE_DETERMINISTIC')).toBe('medium');
    expect(analyseContextImpact('Remember to update the docs', 'PROMOTE')).toBe('medium');
  });

  it('returns low for neutral context', () => {
    expect(analyseContextImpact('The sky is blue', 'EXECUTE')).toBe('low');
    expect(analyseContextImpact('Looks good so far', 'VALIDATE_VISUAL')).toBe('low');
  });
});

describe('getRepairStrategy', () => {
  it('returns local_fix for attempt 1', () => {
    const strategy = getRepairStrategy(1);
    expect(strategy.strategy).toBe('local_fix');
    expect(strategy.strategyPrompt).toMatch(/LOCAL FIX/);
    expect(strategy.alternateModelKey).toBeUndefined();
  });

  it('returns root_cause for attempt 2', () => {
    const strategy = getRepairStrategy(2);
    expect(strategy.strategy).toBe('root_cause');
    expect(strategy.strategyPrompt).toMatch(/ROOT CAUSE/);
    expect(strategy.temperature).toBe(0.3);
  });

  it('returns partial_replan for attempt 3', () => {
    const strategy = getRepairStrategy(3);
    expect(strategy.strategy).toBe('partial_replan');
    expect(strategy.strategyPrompt).toMatch(/PARTIAL REPLAN/);
    expect(strategy.temperature).toBe(0.5);
  });

  it('returns alternate_model for attempt 4', () => {
    const strategy = getRepairStrategy(4);
    expect(strategy.strategy).toBe('alternate_model');
    expect(strategy.alternateModelKey).toBe('planner');
    expect(strategy.strategyPrompt).toMatch(/FRESH PERSPECTIVE/);
  });

  it('returns escalate for attempt 5+', () => {
    expect(getRepairStrategy(5).strategy).toBe('escalate');
    expect(getRepairStrategy(10).strategy).toBe('escalate');
  });

  it('each strategy has a different prompt', () => {
    const prompts = [1, 2, 3, 4].map(n => getRepairStrategy(n).strategyPrompt);
    const uniquePrompts = new Set(prompts);
    expect(uniquePrompts.size).toBe(4);
  });
});

describe('formatRepairHistory', () => {
  it('returns message for empty history', () => {
    expect(formatRepairHistory([])).toBe('No prior attempts.');
  });

  it('formats structured repair records', () => {
    const history = [
      {
        attemptNumber: 1,
        strategy: 'local_fix' as const,
        issueId: 'issue-1',
        patchPlan: 'Fixed missing import',
        changedFiles: ['src/index.ts'],
        outcome: 'still_failing' as const,
        description: 'Added import but type error persists',
      },
    ];
    const formatted = formatRepairHistory(history);
    expect(formatted).toContain('Attempt 1');
    expect(formatted).toContain('local_fix');
    expect(formatted).toContain('still_failing');
    expect(formatted).toContain('src/index.ts');
  });
});

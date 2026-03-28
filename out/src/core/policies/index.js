// ─── Validation Profile Generator ────────────────────────────────────────────
const PROFILES = {
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
export function getValidationProfile(classification) {
    const profile = PROFILES[classification.taskType] ?? PROFILES.unknown;
    return {
        taskType: classification.taskType,
        ...profile,
    };
}
// ─── Retry Policy ─────────────────────────────────────────────────────────────
export function shouldEscalate(issueId, retryCounts, policy) {
    const issueRetries = retryCounts[`issue:${issueId}`] ?? 0;
    // Only count issue-level retries for the total — exclude the 'run' key
    const totalRepairs = Object.entries(retryCounts)
        .filter(([key]) => key.startsWith('issue:'))
        .reduce((sum, [, count]) => sum + count, 0);
    return (issueRetries >= policy.maxAutoRepairsPerIssue ||
        totalRepairs >= policy.maxAutoRepairsPerRun);
}
/** Check if we should auto-replan instead of continuing repairs */
export function shouldAutoReplan(retryCounts, policy) {
    // If we've used > 50% of the run budget without resolving anything, replan
    const totalRepairs = Object.entries(retryCounts)
        .filter(([key]) => key.startsWith('issue:'))
        .reduce((sum, [, count]) => sum + count, 0);
    return totalRepairs >= Math.ceil(policy.maxAutoRepairsPerRun / 2);
}
export function shouldContinueRepair(retryCounts, policy) {
    const totalRepairs = Object.entries(retryCounts)
        .filter(([key]) => key.startsWith('issue:'))
        .reduce((sum, [, count]) => sum + count, 0);
    return totalRepairs < policy.maxAutoRepairsPerRun;
}
export function getRepairCount(issueId, retryCounts) {
    return retryCounts[`issue:${issueId}`] ?? 0;
}
// ─── Context Impact Analysis ──────────────────────────────────────────────────
export function analyseContextImpact(message, currentStage) {
    const lower = message.toLowerCase();
    // High impact — affects plan or constraints (word-boundary matching)
    if (/\bdo not\b/.test(lower) ||
        /\bdon't\b/.test(lower) ||
        /\bnever\b/.test(lower) ||
        /\breplan\b/.test(lower) ||
        /\bchange the approach\b/.test(lower) ||
        /\bstart over\b/.test(lower)) {
        return 'high';
    }
    // Medium impact — affects current stage or implementation (word-boundary matching)
    if (/\balso\b/.test(lower) ||
        /\badditionally\b/.test(lower) ||
        /\bmake sure\b/.test(lower) ||
        /\bremember to\b/.test(lower) ||
        /\bimportant:/.test(lower)) {
        return 'medium';
    }
    return 'low';
}
// ─── Enabled Validators (from profile + config intersection) ──────────────────
export function resolveValidators(profile, configEnabled) {
    return profile.required.filter((v) => configEnabled[v] !== false);
}
//# sourceMappingURL=index.js.map
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import yaml from 'js-yaml';
const DEFAULTS = {
    project: {
        name: 'my-project',
        root: '.',
        framework: 'auto',
        packageManager: 'auto',
    },
    // All roles default to Claude so you only need one API key to start.
    // Every role is independently swappable — change provider and model per role
    // in maiker.config.yaml. Built-in providers: claude, openai, gemini, pi-mono.
    models: {
        researchIngestion: { provider: 'claude', model: 'claude-sonnet-4-6' },
        planner: { provider: 'claude', model: 'claude-sonnet-4-6' },
        codeGeneration: { provider: 'claude', model: 'claude-sonnet-4-6' },
        repairAgent: { provider: 'claude', model: 'claude-sonnet-4-6' },
        visualReview: { provider: 'claude', model: 'claude-sonnet-4-6' },
        postApprovalReview: { provider: 'claude', model: 'claude-sonnet-4-6' },
    },
    validators: {
        install: true,
        build: true,
        lint: true,
        typecheck: true,
        unit_tests: true,
        integration_tests: false,
        playwright_e2e: true,
        screenshot_capture: true,
        visual_review: true,
        ux_rules: true,
        accessibility: false,
        lockfile_sanity: false,
        regression_tests: false,
        mobile_layout_rules: false,
    },
    playwright: {
        baseUrl: 'http://localhost:3000',
        viewports: [
            [320, 568],
            [375, 667],
            [390, 844],
            [414, 896],
            [768, 1024],
        ],
        routes: ['/', '/dashboard', '/settings'],
        timeout: 30000,
    },
    policies: {
        requireHumanApproval: true,
        postApprovalReviewRequired: true,
        maxAutoRepairsPerIssue: 3,
        maxAutoRepairsPerRun: 6,
        maxVisualRetries: 2,
        stopOnBuildFailure: false,
    },
    artifacts: {
        outputDir: '.maiker/runs',
        saveScreenshots: true,
        savePlaywrightTrace: true,
        saveDiffReports: true,
    },
};
function toCamelCase(obj) {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
        const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            result[camel] = toCamelCase(value);
        }
        else {
            result[camel] = value;
        }
    }
    return result;
}
export function loadConfig(configPath) {
    const paths = [
        configPath,
        'maiker.config.yaml',
        'maiker.config.yml',
        '.maiker/config.yaml',
    ].filter(Boolean);
    for (const p of paths) {
        const abs = resolve(p);
        if (existsSync(abs)) {
            try {
                const raw = readFileSync(abs, 'utf-8');
                const parsed = yaml.load(raw);
                const camel = toCamelCase(parsed);
                return deepMerge(DEFAULTS, camel);
            }
            catch (err) {
                throw new Error(`Failed to parse config at ${abs}: ${String(err)}`);
            }
        }
    }
    return DEFAULTS;
}
export function getDefaultConfig() {
    return structuredClone(DEFAULTS);
}
function deepMerge(base, override) {
    const result = { ...base };
    for (const [key, value] of Object.entries(override)) {
        if (value !== null &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            key in result &&
            typeof result[key] === 'object' &&
            !Array.isArray(result[key])) {
            result[key] = deepMerge(result[key], value);
        }
        else if (value !== undefined) {
            result[key] = value;
        }
    }
    return result;
}
export function getEnabledValidators(config) {
    return Object.entries(config.validators)
        .filter(([, enabled]) => enabled)
        .map(([name]) => name);
}
export function getModelConfig(config, stage) {
    return config.models[stage];
}
//# sourceMappingURL=index.js.map
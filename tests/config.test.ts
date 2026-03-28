import { describe, it, expect } from 'vitest';
import { loadConfig, getDefaultConfig, getEnabledValidators } from '../src/config/index.js';

describe('getDefaultConfig', () => {
  it('returns valid default config', () => {
    const config = getDefaultConfig();
    expect(config.project.name).toBe('my-project');
    expect(config.project.framework).toBe('auto');
    expect(config.project.packageManager).toBe('auto');
  });

  it('has all model roles defined', () => {
    const config = getDefaultConfig();
    expect(config.models.researchIngestion).toBeDefined();
    expect(config.models.planner).toBeDefined();
    expect(config.models.codeGeneration).toBeDefined();
    expect(config.models.repairAgent).toBeDefined();
    expect(config.models.visualReview).toBeDefined();
    expect(config.models.postApprovalReview).toBeDefined();
  });

  it('defaults all models to Claude Sonnet', () => {
    const config = getDefaultConfig();
    for (const model of Object.values(config.models)) {
      expect(model.provider).toBe('claude');
      expect(model.model).toBe('claude-sonnet-4-6');
    }
  });

  it('has sensible policy defaults', () => {
    const config = getDefaultConfig();
    expect(config.policies.maxAutoRepairsPerIssue).toBe(3);
    expect(config.policies.maxAutoRepairsPerRun).toBe(6);
    expect(config.policies.maxVisualRetries).toBe(2);
    expect(config.policies.requireHumanApproval).toBe(true);
  });

  it('has playwright viewports configured', () => {
    const config = getDefaultConfig();
    expect(config.playwright.viewports.length).toBeGreaterThan(0);
    expect(config.playwright.baseUrl).toBe('http://localhost:3000');
  });

  it('returns a new object each time (no mutation)', () => {
    const a = getDefaultConfig();
    const b = getDefaultConfig();
    a.project.name = 'mutated';
    expect(b.project.name).toBe('my-project');
  });
});

describe('getEnabledValidators', () => {
  it('returns enabled validators from config', () => {
    const config = getDefaultConfig();
    const enabled = getEnabledValidators(config);
    expect(enabled).toContain('build');
    expect(enabled).toContain('lint');
    expect(enabled).toContain('typecheck');
    expect(enabled).toContain('unit_tests');
  });

  it('excludes disabled validators', () => {
    const config = getDefaultConfig();
    const enabled = getEnabledValidators(config);
    expect(enabled).not.toContain('accessibility');
    expect(enabled).not.toContain('lockfile_sanity');
  });
});

describe('loadConfig', () => {
  it('returns defaults when no config file exists', () => {
    // Run from a temp dir where no config file exists
    const config = loadConfig('/nonexistent/path/maiker.config.yaml');
    // Falls back to defaults when file doesn't exist
    expect(config.project).toBeDefined();
  });
});

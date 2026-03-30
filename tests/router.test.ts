import { describe, it, expect } from 'vitest';
import { getModelForAgent, describeRouting } from '../src/core/router/index.js';
import { getDefaultConfig } from '../src/config/index.js';
import {
  recordSuccess,
  recordFailure,
  isProviderHealthy,
  buildFallbackChain,
  estimateCost,
  getProviderHealthSummary,
} from '../src/core/models/index.js';

describe('getModelForAgent', () => {
  const config = getDefaultConfig();

  it('routes research to researchIngestion model', () => {
    const model = getModelForAgent('research', config);
    expect(model).toEqual(config.models.researchIngestion);
  });

  it('routes planner to planner model', () => {
    const model = getModelForAgent('planner', config);
    expect(model).toEqual(config.models.planner);
  });

  it('routes coder to codeGeneration model', () => {
    const model = getModelForAgent('coder', config);
    expect(model).toEqual(config.models.codeGeneration);
  });

  it('routes repair to repairAgent model', () => {
    const model = getModelForAgent('repair', config);
    expect(model).toEqual(config.models.repairAgent);
  });

  it('routes visual-review to visualReview model', () => {
    const model = getModelForAgent('visual-review', config);
    expect(model).toEqual(config.models.visualReview);
  });

  it('routes post-approval-review to postApprovalReview model', () => {
    const model = getModelForAgent('post-approval-review', config);
    expect(model).toEqual(config.models.postApprovalReview);
  });
});

describe('describeRouting', () => {
  it('returns a formatted routing description', () => {
    const config = getDefaultConfig();
    const desc = describeRouting(config);
    expect(desc).toContain('Research');
    expect(desc).toContain('Planner');
    expect(desc).toContain('Code');
    expect(desc).toContain('Repair');
    expect(desc).toContain('Visual Review');
    expect(desc).toContain('Post-Approval');
    expect(desc).toContain('claude');
  });
});

describe('provider health tracking', () => {
  it('starts healthy', () => {
    expect(isProviderHealthy('test-provider-fresh')).toBe(true);
  });

  it('stays healthy after success', () => {
    recordSuccess('test-success', 500);
    expect(isProviderHealthy('test-success')).toBe(true);
  });

  it('stays healthy with occasional failures', () => {
    recordFailure('test-occasional');
    recordSuccess('test-occasional', 200);
    expect(isProviderHealthy('test-occasional')).toBe(true);
  });

  it('becomes unhealthy after 3 consecutive failures', () => {
    recordFailure('test-unhealthy');
    recordFailure('test-unhealthy');
    recordFailure('test-unhealthy');
    expect(isProviderHealthy('test-unhealthy')).toBe(false);
  });

  it('recovers after a success', () => {
    recordFailure('test-recover');
    recordFailure('test-recover');
    recordFailure('test-recover');
    expect(isProviderHealthy('test-recover')).toBe(false);
    recordSuccess('test-recover', 300);
    expect(isProviderHealthy('test-recover')).toBe(true);
  });

  it('reports health summary', () => {
    recordSuccess('test-summary', 100);
    const summary = getProviderHealthSummary();
    expect(summary['test-summary']).toBeDefined();
    expect(summary['test-summary'].healthy).toBe(true);
    expect(summary['test-summary'].avgLatencyMs).toBeGreaterThan(0);
  });
});

describe('fallback chains', () => {
  it('builds a fallback chain starting with primary', () => {
    const primary = { provider: 'claude', model: 'claude-sonnet-4-6' };
    const chain = buildFallbackChain('codeGeneration', primary, ['claude', 'openai']);
    expect(chain[0]).toEqual(primary);
    expect(chain.length).toBeGreaterThan(1);
  });

  it('includes models from other providers', () => {
    const primary = { provider: 'claude', model: 'claude-sonnet-4-6' };
    const chain = buildFallbackChain('codeGeneration', primary, ['claude', 'openai', 'gemini']);
    const providers = new Set(chain.map(c => c.provider));
    expect(providers.size).toBeGreaterThan(1);
  });
});

describe('cost estimation', () => {
  it('estimates cost for a known model', () => {
    const estimate = estimateCost(
      { provider: 'claude', model: 'claude-sonnet-4-6' },
      10_000, // 10K input tokens
      5_000,  // 5K output tokens
    );
    expect(estimate.estimatedCostUSD).toBeGreaterThan(0);
    expect(estimate.estimatedCostUSD).toBeLessThan(1); // Should be well under $1 for small calls
    expect(estimate.provider).toBe('claude');
    expect(estimate.model).toBe('claude-sonnet-4-6');
  });

  it('falls back to defaults for unknown models', () => {
    const estimate = estimateCost(
      { provider: 'custom', model: 'custom-model' },
      100_000,
      50_000,
    );
    expect(estimate.estimatedCostUSD).toBeGreaterThan(0);
  });
});

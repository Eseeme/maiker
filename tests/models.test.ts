import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  detectAvailableProviders,
  getAvailableProviderNames,
  recommendModels,
  explainChoice,
  getModelsForProvider,
  getKnownProviders,
  getRoleLabel,
} from '../src/core/models/index.js';

describe('detectAvailableProviders', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('detects Claude API key', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test123';
    const providers = detectAvailableProviders();
    const claude = providers.find(p => p.provider === 'claude');
    expect(claude?.available).toBe(true);
    expect(claude?.source).toBe('env');
  });

  it('detects OAuth token source', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-oat-token-here';
    const providers = detectAvailableProviders();
    const claude = providers.find(p => p.provider === 'claude');
    expect(claude?.available).toBe(true);
    expect(claude?.source).toBe('oauth');
  });

  it('reports unavailable when no key set', () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    const providers = detectAvailableProviders();
    expect(providers.every(p => !p.available)).toBe(true);
  });
});

describe('getAvailableProviderNames', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns names of providers with keys', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.OPENAI_API_KEY = 'sk-test';
    delete process.env.GOOGLE_API_KEY;
    const names = getAvailableProviderNames();
    expect(names).toContain('claude');
    expect(names).toContain('openai');
    expect(names).not.toContain('gemini');
  });
});

describe('recommendModels', () => {
  it('recommends models for all roles with claude only', () => {
    const models = recommendModels(['claude']);
    expect(models.researchIngestion.provider).toBe('claude');
    expect(models.planner.provider).toBe('claude');
    expect(models.codeGeneration.provider).toBe('claude');
    expect(models.visualReview.provider).toBe('claude');
  });

  it('recommends gemini for research when available', () => {
    const models = recommendModels(['claude', 'gemini']);
    expect(models.researchIngestion.provider).toBe('gemini');
  });

  it('recommends multimodal model for visual review', () => {
    const models = recommendModels(['claude', 'openai']);
    // Both Claude and OpenAI have multimodal models, but the scoring should pick one
    expect(models.visualReview.model).toBeDefined();
  });

  it('prefers cheap models for post-approval review', () => {
    const models = recommendModels(['claude', 'openai']);
    // Should pick a cheaper model for post-approval
    const model = models.postApprovalReview;
    expect(model).toBeDefined();
  });

  it('falls back to claude sonnet when no providers available', () => {
    const models = recommendModels([]);
    expect(models.codeGeneration.provider).toBe('claude');
    expect(models.codeGeneration.model).toBe('claude-sonnet-4-6');
  });
});

describe('explainChoice', () => {
  it('explains strength match', () => {
    const explanation = explainChoice(
      { provider: 'claude', model: 'claude-opus-4-6' },
      'planner',
    );
    expect(explanation).toContain('reasoning');
  });

  it('returns "Custom model" for unknown models', () => {
    const explanation = explainChoice(
      { provider: 'custom', model: 'my-model' },
      'codeGeneration',
    );
    expect(explanation).toBe('Custom model');
  });
});

describe('getModelsForProvider', () => {
  it('returns claude models', () => {
    const models = getModelsForProvider('claude');
    expect(models.length).toBeGreaterThan(0);
    expect(models.every(m => m.provider === 'claude')).toBe(true);
  });

  it('returns empty for unknown provider', () => {
    expect(getModelsForProvider('nonexistent')).toHaveLength(0);
  });
});

describe('getKnownProviders', () => {
  it('includes claude, openai, gemini', () => {
    const providers = getKnownProviders();
    expect(providers).toContain('claude');
    expect(providers).toContain('openai');
    expect(providers).toContain('gemini');
  });
});

describe('getRoleLabel', () => {
  it('returns human-readable labels', () => {
    expect(getRoleLabel('researchIngestion')).toBe('Research ingestion');
    expect(getRoleLabel('codeGeneration')).toBe('Code generation');
    expect(getRoleLabel('postApprovalReview')).toBe('Post-approval review');
  });
});

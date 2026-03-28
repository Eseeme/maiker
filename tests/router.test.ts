import { describe, it, expect } from 'vitest';
import { getModelForAgent, describeRouting } from '../src/core/router/index.js';
import { getDefaultConfig } from '../src/config/index.js';

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

  it('falls back to codeGeneration for unknown role', () => {
    const model = getModelForAgent('nonexistent' as any, config);
    expect(model).toEqual(config.models.codeGeneration);
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

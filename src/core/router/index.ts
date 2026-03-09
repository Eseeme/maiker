import type { MaikerConfig, ModelConfig } from '../../types/index.js';

export type AgentRole =
  | 'research'
  | 'planner'
  | 'coder'
  | 'repair'
  | 'visual-review'
  | 'post-approval-review';

export function getModelForAgent(
  role: AgentRole,
  config: MaikerConfig,
): ModelConfig {
  switch (role) {
    case 'research':
      return config.models.researchIngestion;
    case 'planner':
      return config.models.planner;
    case 'coder':
      return config.models.codeGeneration;
    case 'repair':
      return config.models.repairAgent;
    case 'visual-review':
      return config.models.visualReview;
    case 'post-approval-review':
      return config.models.postApprovalReview;
    default:
      return config.models.codeGeneration;
  }
}

export function describeRouting(config: MaikerConfig): string {
  const entries = [
    ['Research', `${config.models.researchIngestion.provider}/${config.models.researchIngestion.model}`],
    ['Planner', `${config.models.planner.provider}/${config.models.planner.model}`],
    ['Code', `${config.models.codeGeneration.provider}/${config.models.codeGeneration.model}`],
    ['Repair', `${config.models.repairAgent.provider}/${config.models.repairAgent.model}`],
    ['Visual Review', `${config.models.visualReview.provider}/${config.models.visualReview.model}`],
    ['Post-Approval', `${config.models.postApprovalReview.provider}/${config.models.postApprovalReview.model}`],
  ];
  return entries.map(([role, model]) => `  ${role.padEnd(16)} → ${model}`).join('\n');
}

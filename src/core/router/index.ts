import type { MaikerConfig, ModelConfig } from '../../types/index.js';
import {
  getHealthyModel,
  getAvailableProviderNames,
  isProviderHealthy,
  getModelEntry,
} from '../models/index.js';
import type { AgentRole as ModelAgentRole } from '../models/index.js';

export type AgentRole =
  | 'research'
  | 'planner'
  | 'coder'
  | 'repair'
  | 'visual-review'
  | 'post-approval-review';

/** Map router role names to model registry role names */
const ROLE_TO_MODEL_ROLE: Record<AgentRole, ModelAgentRole> = {
  'research': 'researchIngestion',
  'planner': 'planner',
  'coder': 'codeGeneration',
  'repair': 'repairAgent',
  'visual-review': 'visualReview',
  'post-approval-review': 'postApprovalReview',
};

/** Map router role names to config keys */
const ROLE_TO_CONFIG_KEY: Record<AgentRole, keyof MaikerConfig['models']> = {
  'research': 'researchIngestion',
  'planner': 'planner',
  'coder': 'codeGeneration',
  'repair': 'repairAgent',
  'visual-review': 'visualReview',
  'post-approval-review': 'postApprovalReview',
};

/**
 * Get the model for an agent role, with health-aware fallback.
 * If the configured provider is unhealthy, falls back to the next best option.
 */
export function getModelForAgent(
  role: AgentRole,
  config: MaikerConfig,
): ModelConfig {
  const configKey = ROLE_TO_CONFIG_KEY[role];
  const primary = config.models[configKey];

  // If primary provider is healthy, use it directly
  if (isProviderHealthy(primary.provider)) {
    return primary;
  }

  // Fall back to next healthy provider
  const modelRole = ROLE_TO_MODEL_ROLE[role];
  const availableProviders = getAvailableProviderNames();
  const fallback = getHealthyModel(modelRole, primary, availableProviders);

  if (fallback.provider !== primary.provider || fallback.model !== primary.model) {
    console.warn(
      `[router] ${role}: ${primary.provider}/${primary.model} unhealthy, ` +
      `falling back to ${fallback.provider}/${fallback.model}`,
    );
  }

  return fallback;
}

export function describeRouting(config: MaikerConfig): string {
  const entries: Array<[string, string, string]> = [
    ['Research', `${config.models.researchIngestion.provider}/${config.models.researchIngestion.model}`, healthIcon(config.models.researchIngestion.provider)],
    ['Planner', `${config.models.planner.provider}/${config.models.planner.model}`, healthIcon(config.models.planner.provider)],
    ['Code', `${config.models.codeGeneration.provider}/${config.models.codeGeneration.model}`, healthIcon(config.models.codeGeneration.provider)],
    ['Repair', `${config.models.repairAgent.provider}/${config.models.repairAgent.model}`, healthIcon(config.models.repairAgent.provider)],
    ['Visual Review', `${config.models.visualReview.provider}/${config.models.visualReview.model}`, healthIcon(config.models.visualReview.provider)],
    ['Post-Approval', `${config.models.postApprovalReview.provider}/${config.models.postApprovalReview.model}`, healthIcon(config.models.postApprovalReview.provider)],
  ];
  return entries.map(([role, model, icon]) => `  ${role.padEnd(16)} ${icon} ${model}`).join('\n');
}

function healthIcon(provider: string): string {
  return isProviderHealthy(provider) ? '+' : '!';
}

/**
 * Get estimated cost info for a model config.
 */
export function getModelInfo(config: ModelConfig): {
  costTier: number;
  latencyTier: number;
  contextWindow: number;
  supportsToolUse: boolean;
} {
  const entry = getModelEntry(config);
  return {
    costTier: entry?.costTier ?? 2,
    latencyTier: entry?.latencyTier ?? 2,
    contextWindow: entry?.contextWindow ?? 200_000,
    supportsToolUse: entry?.supportsToolUse ?? false,
  };
}

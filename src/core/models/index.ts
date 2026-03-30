/**
 * Model Recommendation Engine
 *
 * Knows which models exist per provider, what they're good at,
 * and recommends the best model per role based on available API keys.
 */

import type { ModelConfig } from '../../types/index.js';

// ─── Provider / Model Registry ───────────────────────────────────────────────

export interface ModelEntry {
  provider: string;
  model: string;
  /** What this model is best at */
  strengths: string[];
  /** Relative cost tier: 1=cheap, 2=mid, 3=expensive */
  costTier: number;
  /** Context window size in tokens */
  contextWindow: number;
  /** Supports vision/multimodal */
  multimodal: boolean;
  /** Approximate cost per 1M input tokens (USD) */
  inputCostPer1M?: number;
  /** Approximate cost per 1M output tokens (USD) */
  outputCostPer1M?: number;
  /** Relative latency tier: 1=fast, 2=medium, 3=slow */
  latencyTier?: number;
  /** Whether this model supports native function calling / tool use */
  supportsToolUse?: boolean;
}

export type AgentRole =
  | 'researchIngestion'
  | 'planner'
  | 'codeGeneration'
  | 'repairAgent'
  | 'visualReview'
  | 'postApprovalReview';

const ROLE_LABELS: Record<AgentRole, string> = {
  researchIngestion: 'Research ingestion',
  planner: 'Planner',
  codeGeneration: 'Code generation',
  repairAgent: 'Repair',
  visualReview: 'Visual review',
  postApprovalReview: 'Post-approval review',
};

export function getRoleLabel(role: AgentRole): string {
  return ROLE_LABELS[role] ?? role;
}

/** All known models grouped by provider */
const MODEL_REGISTRY: ModelEntry[] = [
  // ── Claude ──
  { provider: 'claude', model: 'claude-opus-4-6',    strengths: ['reasoning', 'code', 'analysis', 'planning'], costTier: 3, contextWindow: 200_000, multimodal: true, inputCostPer1M: 15, outputCostPer1M: 75, latencyTier: 3, supportsToolUse: true },
  { provider: 'claude', model: 'claude-sonnet-4-6',  strengths: ['code', 'analysis', 'repair', 'fast'],        costTier: 2, contextWindow: 200_000, multimodal: true, inputCostPer1M: 3, outputCostPer1M: 15, latencyTier: 2, supportsToolUse: true },
  { provider: 'claude', model: 'claude-haiku-4-5',   strengths: ['fast', 'cheap', 'review'],                   costTier: 1, contextWindow: 200_000, multimodal: true, inputCostPer1M: 0.8, outputCostPer1M: 4, latencyTier: 1, supportsToolUse: true },

  // ── OpenAI ──
  { provider: 'openai', model: 'o3',                 strengths: ['reasoning', 'planning', 'analysis'],         costTier: 3, contextWindow: 200_000, multimodal: false, inputCostPer1M: 10, outputCostPer1M: 40, latencyTier: 3, supportsToolUse: true },
  { provider: 'openai', model: 'gpt-4o',             strengths: ['code', 'vision', 'fast'],                    costTier: 2, contextWindow: 128_000, multimodal: true, inputCostPer1M: 2.5, outputCostPer1M: 10, latencyTier: 2, supportsToolUse: true },
  { provider: 'openai', model: 'gpt-4o-mini',        strengths: ['fast', 'cheap', 'review'],                   costTier: 1, contextWindow: 128_000, multimodal: true, inputCostPer1M: 0.15, outputCostPer1M: 0.6, latencyTier: 1, supportsToolUse: true },
  { provider: 'openai', model: 'codex-mini',         strengths: ['code', 'repair', 'fast'],                    costTier: 1, contextWindow: 200_000, multimodal: false, inputCostPer1M: 1.5, outputCostPer1M: 6, latencyTier: 1, supportsToolUse: true },

  // ── Gemini ──
  { provider: 'gemini', model: 'gemini-2.5-pro',     strengths: ['research', 'large-context', 'reasoning'],    costTier: 2, contextWindow: 1_000_000, multimodal: true, inputCostPer1M: 1.25, outputCostPer1M: 10, latencyTier: 2, supportsToolUse: true },
  { provider: 'gemini', model: 'gemini-2.5-flash',   strengths: ['fast', 'cheap', 'research'],                 costTier: 1, contextWindow: 1_000_000, multimodal: true, inputCostPer1M: 0.15, outputCostPer1M: 0.6, latencyTier: 1, supportsToolUse: true },
];

/** What each role needs from a model */
const ROLE_PRIORITIES: Record<AgentRole, { needs: string[]; prefersMultimodal: boolean; prefersCheap: boolean }> = {
  researchIngestion:   { needs: ['research', 'large-context', 'reasoning'],  prefersMultimodal: false, prefersCheap: false },
  planner:             { needs: ['reasoning', 'planning', 'analysis'],       prefersMultimodal: false, prefersCheap: false },
  codeGeneration:      { needs: ['code'],                                     prefersMultimodal: false, prefersCheap: false },
  repairAgent:         { needs: ['code', 'repair', 'analysis'],              prefersMultimodal: false, prefersCheap: false },
  visualReview:        { needs: ['vision'],                                   prefersMultimodal: true,  prefersCheap: false },
  postApprovalReview:  { needs: ['review', 'analysis'],                      prefersMultimodal: false, prefersCheap: true },
};

// ─── Key Detection ───────────────────────────────────────────────────────────

export interface ProviderAvailability {
  provider: string;
  envVar: string;
  available: boolean;
  /** How the key was obtained: 'env' (from .env), 'oauth' (Claude Code login), or undefined */
  source?: 'env' | 'oauth';
}

const PROVIDER_ENV_VARS: Record<string, string> = {
  claude: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GOOGLE_API_KEY',
};

/** Check which providers have API keys set in environment */
export function detectAvailableProviders(): ProviderAvailability[] {
  return Object.entries(PROVIDER_ENV_VARS).map(([provider, envVar]) => {
    const value = process.env[envVar]?.trim();
    const available = !!value;
    let source: 'env' | 'oauth' | undefined;
    if (available) {
      source = value!.startsWith('sk-ant-oat') ? 'oauth' : 'env';
    }
    return { provider, envVar, available, source };
  });
}

/** Get list of provider names that have valid keys */
export function getAvailableProviderNames(): string[] {
  return detectAvailableProviders()
    .filter(p => p.available)
    .map(p => p.provider);
}

// ─── Model Scoring & Recommendation ─────────────────────────────────────────

/** Score a model for a specific role (higher = better fit) */
function scoreModelForRole(model: ModelEntry, role: AgentRole): number {
  const priorities = ROLE_PRIORITIES[role];
  let score = 0;

  // Strength match: +3 for each matching strength
  for (const need of priorities.needs) {
    if (model.strengths.includes(need)) score += 3;
  }

  // Multimodal bonus for roles that need it
  if (priorities.prefersMultimodal && model.multimodal) score += 5;
  // Penalise non-multimodal models for visual roles
  if (priorities.prefersMultimodal && !model.multimodal) score -= 10;

  // Cost preference
  if (priorities.prefersCheap) {
    score += (4 - model.costTier); // cheaper = higher score
  }

  // Context window bonus for research
  if (role === 'researchIngestion' && model.contextWindow >= 500_000) score += 3;

  return score;
}

/** Recommend the best model for each role given available providers */
export function recommendModels(
  availableProviders: string[],
): Record<AgentRole, ModelConfig> {
  const available = MODEL_REGISTRY.filter(m => availableProviders.includes(m.provider));
  const roles = Object.keys(ROLE_PRIORITIES) as AgentRole[];
  const result = {} as Record<AgentRole, ModelConfig>;

  for (const role of roles) {
    // Score all available models for this role
    const scored = available
      .map(m => ({ model: m, score: scoreModelForRole(m, role) }))
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      // No models available — shouldn't happen if at least one key is set
      result[role] = { provider: 'claude', model: 'claude-sonnet-4-6' };
    } else {
      const best = scored[0].model;
      result[role] = { provider: best.provider, model: best.model };
    }
  }

  return result;
}

/** Get all available models for a specific provider */
export function getModelsForProvider(provider: string): ModelEntry[] {
  return MODEL_REGISTRY.filter(m => m.provider === provider);
}

/** Get all known providers */
export function getKnownProviders(): string[] {
  return [...new Set(MODEL_REGISTRY.map(m => m.provider))];
}

/** Describe why a model was chosen for a role */
export function explainChoice(model: ModelConfig, role: AgentRole): string {
  const entry = MODEL_REGISTRY.find(m => m.provider === model.provider && m.model === model.model);
  if (!entry) return 'Custom model';
  const priorities = ROLE_PRIORITIES[role];
  const matches = entry.strengths.filter(s => priorities.needs.includes(s));
  return matches.length > 0 ? matches.join(', ') : entry.strengths[0] ?? 'general purpose';
}

// ─── Key Validation ──────────────────────────────────────────────────────────

/** Validate that an API key works by making a minimal request */
export async function validateProviderKey(provider: string): Promise<{ valid: boolean; error?: string }> {
  try {
    switch (provider) {
      case 'claude': {
        const { default: Anthropic } = await import('@anthropic-ai/sdk');
        const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
        // OAuth tokens use authToken, regular keys use apiKey
        const client = apiKey.startsWith('sk-ant-oat')
          ? new Anthropic({ authToken: apiKey, apiKey: undefined as unknown as string })
          : new Anthropic();
        // Minimal request — will fail fast if key is invalid
        await client.messages.create({
          model: 'claude-haiku-4-5',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        });
        return { valid: true };
      }
      case 'openai': {
        const key = process.env.OPENAI_API_KEY;
        if (!key) return { valid: false, error: 'OPENAI_API_KEY not set' };
        const res = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
        });
        if (!res.ok) return { valid: false, error: `HTTP ${res.status}` };
        return { valid: true };
      }
      case 'gemini': {
        const key = process.env.GOOGLE_API_KEY;
        if (!key) return { valid: false, error: 'GOOGLE_API_KEY not set' };
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
        );
        if (!res.ok) return { valid: false, error: `HTTP ${res.status}` };
        return { valid: true };
      }
      default:
        return { valid: false, error: `Unknown provider: ${provider}` };
    }
  } catch (err) {
    return { valid: false, error: String(err) };
  }
}

// ─── Provider Health Tracking ────────────────────────────────────────────────

interface ProviderHealthState {
  lastSuccess: number;   // timestamp
  lastFailure: number;   // timestamp
  consecutiveFailures: number;
  totalCalls: number;
  totalFailures: number;
  /** Average latency in ms (rolling window) */
  avgLatencyMs: number;
}

const providerHealth = new Map<string, ProviderHealthState>();

function getHealthState(provider: string): ProviderHealthState {
  if (!providerHealth.has(provider)) {
    providerHealth.set(provider, {
      lastSuccess: 0,
      lastFailure: 0,
      consecutiveFailures: 0,
      totalCalls: 0,
      totalFailures: 0,
      avgLatencyMs: 0,
    });
  }
  return providerHealth.get(provider)!;
}

/** Record a successful API call for health tracking */
export function recordSuccess(provider: string, latencyMs: number): void {
  const state = getHealthState(provider);
  state.lastSuccess = Date.now();
  state.consecutiveFailures = 0;
  state.totalCalls++;
  // Rolling average
  state.avgLatencyMs = state.avgLatencyMs === 0
    ? latencyMs
    : state.avgLatencyMs * 0.8 + latencyMs * 0.2;
}

/** Record a failed API call for health tracking */
export function recordFailure(provider: string): void {
  const state = getHealthState(provider);
  state.lastFailure = Date.now();
  state.consecutiveFailures++;
  state.totalCalls++;
  state.totalFailures++;
}

/** Check if a provider is considered healthy */
export function isProviderHealthy(provider: string): boolean {
  const state = getHealthState(provider);
  // Unhealthy if 3+ consecutive failures in the last 5 minutes
  if (state.consecutiveFailures >= 3) {
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    if (state.lastFailure > fiveMinAgo) return false;
  }
  return true;
}

/** Get health summary for all tracked providers */
export function getProviderHealthSummary(): Record<string, {
  healthy: boolean;
  consecutiveFailures: number;
  avgLatencyMs: number;
  successRate: number;
}> {
  const summary: Record<string, any> = {};
  for (const [provider, state] of providerHealth) {
    summary[provider] = {
      healthy: isProviderHealthy(provider),
      consecutiveFailures: state.consecutiveFailures,
      avgLatencyMs: Math.round(state.avgLatencyMs),
      successRate: state.totalCalls > 0
        ? Math.round(((state.totalCalls - state.totalFailures) / state.totalCalls) * 100)
        : 100,
    };
  }
  return summary;
}

// ─── Fallback Chains ─────────────────────────────────────────────────────────

/**
 * Build a fallback chain for a given role.
 * Returns an ordered list of model configs: primary, then alternatives
 * ranked by score, excluding unhealthy providers.
 */
export function buildFallbackChain(
  role: AgentRole,
  primaryConfig: ModelConfig,
  availableProviders: string[],
): ModelConfig[] {
  const chain: ModelConfig[] = [primaryConfig];

  // Get all available models scored for this role
  const available = MODEL_REGISTRY.filter(m =>
    availableProviders.includes(m.provider) &&
    !(m.provider === primaryConfig.provider && m.model === primaryConfig.model),
  );

  const scored = available
    .filter(m => isProviderHealthy(m.provider))
    .map(m => ({ model: m, score: scoreModelForRole(m, role) }))
    .sort((a, b) => b.score - a.score);

  for (const { model } of scored) {
    chain.push({ provider: model.provider, model: model.model });
  }

  return chain;
}

/**
 * Get the best available model for a role, considering health.
 * Falls through the chain until a healthy provider is found.
 */
export function getHealthyModel(
  role: AgentRole,
  primaryConfig: ModelConfig,
  availableProviders: string[],
): ModelConfig {
  if (isProviderHealthy(primaryConfig.provider)) {
    return primaryConfig;
  }

  const chain = buildFallbackChain(role, primaryConfig, availableProviders);
  for (const config of chain) {
    if (isProviderHealthy(config.provider)) {
      return config;
    }
  }

  // All unhealthy — return primary anyway (it may recover)
  return primaryConfig;
}

// ─── Cost Estimation ─────────────────────────────────────────────────────────

export interface CostEstimate {
  provider: string;
  model: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUSD: number;
}

/**
 * Estimate the cost for a model call given token counts.
 */
export function estimateCost(
  config: ModelConfig,
  inputTokens: number,
  outputTokens: number,
): CostEstimate {
  const entry = MODEL_REGISTRY.find(m => m.provider === config.provider && m.model === config.model);
  const inputCost = (entry?.inputCostPer1M ?? 3) * (inputTokens / 1_000_000);
  const outputCost = (entry?.outputCostPer1M ?? 15) * (outputTokens / 1_000_000);

  return {
    provider: config.provider,
    model: config.model,
    estimatedInputTokens: inputTokens,
    estimatedOutputTokens: outputTokens,
    estimatedCostUSD: Math.round((inputCost + outputCost) * 10000) / 10000,
  };
}

/**
 * Look up a model entry from the registry.
 */
export function getModelEntry(config: ModelConfig): ModelEntry | undefined {
  return MODEL_REGISTRY.find(m => m.provider === config.provider && m.model === config.model);
}

/** Validate all providers used in current config */
export async function validateConfiguredProviders(
  models: Record<string, ModelConfig>,
): Promise<Record<string, { valid: boolean; error?: string }>> {
  const providers = new Set(Object.values(models).map(m => m.provider));
  const results: Record<string, { valid: boolean; error?: string }> = {};

  // Validate in parallel
  await Promise.all(
    [...providers].map(async (provider) => {
      results[provider] = await validateProviderKey(provider);
    }),
  );

  return results;
}

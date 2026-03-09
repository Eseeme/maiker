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
  { provider: 'claude', model: 'claude-opus-4-6',    strengths: ['reasoning', 'code', 'analysis', 'planning'], costTier: 3, contextWindow: 200_000, multimodal: true },
  { provider: 'claude', model: 'claude-sonnet-4-6',  strengths: ['code', 'analysis', 'repair', 'fast'],        costTier: 2, contextWindow: 200_000, multimodal: true },
  { provider: 'claude', model: 'claude-haiku-4-5',   strengths: ['fast', 'cheap', 'review'],                   costTier: 1, contextWindow: 200_000, multimodal: true },

  // ── OpenAI ──
  { provider: 'openai', model: 'o3',                 strengths: ['reasoning', 'planning', 'analysis'],         costTier: 3, contextWindow: 200_000, multimodal: false },
  { provider: 'openai', model: 'gpt-4o',             strengths: ['code', 'vision', 'fast'],                    costTier: 2, contextWindow: 128_000, multimodal: true },
  { provider: 'openai', model: 'gpt-4o-mini',        strengths: ['fast', 'cheap', 'review'],                   costTier: 1, contextWindow: 128_000, multimodal: true },
  { provider: 'openai', model: 'codex-mini',         strengths: ['code', 'repair', 'fast'],                    costTier: 1, contextWindow: 200_000, multimodal: false },

  // ── Gemini ──
  { provider: 'gemini', model: 'gemini-2.5-pro',     strengths: ['research', 'large-context', 'reasoning'],    costTier: 2, contextWindow: 1_000_000, multimodal: true },
  { provider: 'gemini', model: 'gemini-2.5-flash',   strengths: ['fast', 'cheap', 'research'],                 costTier: 1, contextWindow: 1_000_000, multimodal: true },
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
}

const PROVIDER_ENV_VARS: Record<string, string> = {
  claude: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GOOGLE_API_KEY',
};

/** Check which providers have API keys set in environment */
export function detectAvailableProviders(): ProviderAvailability[] {
  return Object.entries(PROVIDER_ENV_VARS).map(([provider, envVar]) => ({
    provider,
    envVar,
    available: !!process.env[envVar]?.trim(),
  }));
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
        const client = new Anthropic();
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

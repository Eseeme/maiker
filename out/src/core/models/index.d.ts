/**
 * Model Recommendation Engine
 *
 * Knows which models exist per provider, what they're good at,
 * and recommends the best model per role based on available API keys.
 */
import type { ModelConfig } from '../../types/index.js';
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
export type AgentRole = 'researchIngestion' | 'planner' | 'codeGeneration' | 'repairAgent' | 'visualReview' | 'postApprovalReview';
export declare function getRoleLabel(role: AgentRole): string;
export interface ProviderAvailability {
    provider: string;
    envVar: string;
    available: boolean;
    /** How the key was obtained: 'env' (from .env), 'oauth' (Claude Code login), or undefined */
    source?: 'env' | 'oauth';
}
/** Check which providers have API keys set in environment */
export declare function detectAvailableProviders(): ProviderAvailability[];
/** Get list of provider names that have valid keys */
export declare function getAvailableProviderNames(): string[];
/** Recommend the best model for each role given available providers */
export declare function recommendModels(availableProviders: string[]): Record<AgentRole, ModelConfig>;
/** Get all available models for a specific provider */
export declare function getModelsForProvider(provider: string): ModelEntry[];
/** Get all known providers */
export declare function getKnownProviders(): string[];
/** Describe why a model was chosen for a role */
export declare function explainChoice(model: ModelConfig, role: AgentRole): string;
/** Validate that an API key works by making a minimal request */
export declare function validateProviderKey(provider: string): Promise<{
    valid: boolean;
    error?: string;
}>;
/** Validate all providers used in current config */
export declare function validateConfiguredProviders(models: Record<string, ModelConfig>): Promise<Record<string, {
    valid: boolean;
    error?: string;
}>>;
//# sourceMappingURL=index.d.ts.map
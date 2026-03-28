import type { MaikerConfig, ModelConfig } from '../../types/index.js';
export type AgentRole = 'research' | 'planner' | 'coder' | 'repair' | 'visual-review' | 'post-approval-review';
export declare function getModelForAgent(role: AgentRole, config: MaikerConfig): ModelConfig;
export declare function describeRouting(config: MaikerConfig): string;
//# sourceMappingURL=index.d.ts.map
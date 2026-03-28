import type { ModelConfig } from '../../types/index.js';
import type { LLMMessage } from '../../providers/claude/index.js';
export declare function callModel(config: ModelConfig, systemPrompt: string, userMessage: string): Promise<string>;
export declare function callModelWithMessages(config: ModelConfig, systemPrompt: string, messages: LLMMessage[]): Promise<string>;
export declare function parseJsonFromResponse<T>(raw: string): T;
//# sourceMappingURL=base.d.ts.map
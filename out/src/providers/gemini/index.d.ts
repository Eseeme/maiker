import type { ModelConfig } from '../../types/index.js';
import type { LLMMessage, LLMResponse } from '../claude/index.js';
export declare function geminiChat(config: ModelConfig, systemPrompt: string, messages: LLMMessage[]): Promise<LLMResponse>;
export declare function geminiComplete(config: ModelConfig, systemPrompt: string, userMessage: string): Promise<string>;
//# sourceMappingURL=index.d.ts.map
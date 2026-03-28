import type { ModelConfig } from '../../types/index.js';
import type { LLMMessage, LLMResponse } from '../claude/index.js';
export declare function openaiChat(config: ModelConfig, systemPrompt: string, messages: LLMMessage[]): Promise<LLMResponse>;
export declare function openaiComplete(config: ModelConfig, systemPrompt: string, userMessage: string): Promise<string>;
//# sourceMappingURL=index.d.ts.map
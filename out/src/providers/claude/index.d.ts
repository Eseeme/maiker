import type { ModelConfig } from '../../types/index.js';
export interface LLMMessage {
    role: 'user' | 'assistant';
    content: string;
}
export interface LLMResponse {
    content: string;
    model: string;
    usage?: {
        inputTokens: number;
        outputTokens: number;
    };
}
export declare function claudeChat(config: ModelConfig, systemPrompt: string, messages: LLMMessage[]): Promise<LLMResponse>;
export declare function claudeComplete(config: ModelConfig, systemPrompt: string, userMessage: string): Promise<string>;
//# sourceMappingURL=index.d.ts.map
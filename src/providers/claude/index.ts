import Anthropic from '@anthropic-ai/sdk';
import type { ModelConfig } from '../../types/index.js';

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY is not set. Please add it to your .env file.',
      );
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

export async function claudeChat(
  config: ModelConfig,
  systemPrompt: string,
  messages: LLMMessage[],
): Promise<LLMResponse> {
  const anthropic = getClient();
  const response = await anthropic.messages.create({
    model: config.model,
    max_tokens: config.maxTokens ?? 8192,
    system: systemPrompt,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  });

  const content =
    response.content[0]?.type === 'text' ? response.content[0].text : '';

  return {
    content,
    model: response.model,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}

export async function claudeComplete(
  config: ModelConfig,
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  const resp = await claudeChat(config, systemPrompt, [
    { role: 'user', content: userMessage },
  ]);
  return resp.content;
}

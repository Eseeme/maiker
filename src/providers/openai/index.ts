import type { ModelConfig } from '../../types/index.js';
import type { LLMMessage, LLMResponse } from '../claude/index.js';

// OpenAI provider adapter
// Requires: npm install openai
// Set OPENAI_API_KEY in .env

let OpenAI: typeof import('openai').default | null = null;

async function getClient() {
  if (!OpenAI) {
    try {
      const mod = await import('openai');
      OpenAI = mod.default;
    } catch {
      throw new Error(
        'openai package not installed. Run: npm install openai',
      );
    }
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set.');
  }
  return new OpenAI({ apiKey });
}

export async function openaiChat(
  config: ModelConfig,
  systemPrompt: string,
  messages: LLMMessage[],
): Promise<LLMResponse> {
  const client = await getClient();
  const response = await (client as any).chat.completions.create({
    model: config.model,
    max_tokens: config.maxTokens ?? 8192,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
  });

  const content = response.choices[0]?.message?.content ?? '';
  return {
    content,
    model: response.model,
    usage: {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    },
  };
}

export async function openaiComplete(
  config: ModelConfig,
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  const resp = await openaiChat(config, systemPrompt, [
    { role: 'user', content: userMessage },
  ]);
  return resp.content;
}

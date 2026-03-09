import type { ModelConfig } from '../../types/index.js';
import type { LLMMessage, LLMResponse } from '../claude/index.js';

// pi-mono provider adapter — internal model-routing helper
// Configure PI_MONO_API_KEY and PI_MONO_BASE_URL in .env

export async function piMonoChat(
  config: ModelConfig,
  systemPrompt: string,
  messages: LLMMessage[],
): Promise<LLMResponse> {
  const apiKey = process.env.PI_MONO_API_KEY;
  const baseUrl = process.env.PI_MONO_BASE_URL;
  if (!apiKey || !baseUrl) {
    throw new Error('PI_MONO_API_KEY and PI_MONO_BASE_URL must be set.');
  }

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
      max_tokens: config.maxTokens ?? 8192,
    }),
  });

  if (!response.ok) {
    throw new Error(`pi-mono API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
    model: string;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };

  return {
    content: data.choices[0]?.message?.content ?? '',
    model: data.model,
    usage: {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    },
  };
}

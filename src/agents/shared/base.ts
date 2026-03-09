import type { ModelConfig } from '../../types/index.js';
import { claudeComplete } from '../../providers/claude/index.js';
import { openaiComplete } from '../../providers/openai/index.js';
import { geminiComplete } from '../../providers/gemini/index.js';
import type { LLMMessage } from '../../providers/claude/index.js';
import { claudeChat } from '../../providers/claude/index.js';
import { openaiChat } from '../../providers/openai/index.js';
import { geminiChat } from '../../providers/gemini/index.js';

export async function callModel(
  config: ModelConfig,
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  switch (config.provider) {
    case 'claude':
      return claudeComplete(config, systemPrompt, userMessage);
    case 'openai':
      return openaiComplete(config, systemPrompt, userMessage);
    case 'gemini':
      return geminiComplete(config, systemPrompt, userMessage);
    case 'pi-mono': {
      const { piMonoChat } = await import('../../providers/pi-mono/index.js');
      const resp = await piMonoChat(config, systemPrompt, [
        { role: 'user', content: userMessage },
      ]);
      return resp.content;
    }
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

export async function callModelWithMessages(
  config: ModelConfig,
  systemPrompt: string,
  messages: LLMMessage[],
): Promise<string> {
  switch (config.provider) {
    case 'claude': {
      const resp = await claudeChat(config, systemPrompt, messages);
      return resp.content;
    }
    case 'openai': {
      const resp = await openaiChat(config, systemPrompt, messages);
      return resp.content;
    }
    case 'gemini': {
      const resp = await geminiChat(config, systemPrompt, messages);
      return resp.content;
    }
    case 'pi-mono': {
      const { piMonoChat } = await import('../../providers/pi-mono/index.js');
      const resp = await piMonoChat(config, systemPrompt, messages);
      return resp.content;
    }
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

export function parseJsonFromResponse<T>(raw: string): T {
  // Try extracting from markdown code block first
  const fenced = raw.match(/```(?:json)?\s*([\s\S]+?)```/);
  const jsonStr = fenced ? fenced[1] : raw;
  try {
    return JSON.parse(jsonStr.trim()) as T;
  } catch {
    throw new Error(`Failed to parse JSON from model response:\n${raw.slice(0, 500)}`);
  }
}

import type { ModelConfig } from '../../types/index.js';
import type { LLMMessage, LLMResponse } from '../claude/index.js';

// Gemini provider adapter
// Optional: npm install @google/generative-ai
// Set GOOGLE_API_KEY in .env

async function loadGemini(): Promise<unknown> {
  // Use Function constructor to avoid static import analysis
  // This prevents TypeScript from requiring the type declarations
  try {
    return await (new Function('m', 'return import(m)'))('@google/generative-ai');
  } catch {
    throw new Error(
      '@google/generative-ai package not installed. Run: npm install @google/generative-ai',
    );
  }
}

export async function geminiChat(
  config: ModelConfig,
  systemPrompt: string,
  messages: LLMMessage[],
): Promise<LLMResponse> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_API_KEY is not set.');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = (await loadGemini()) as any;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const genAI = new mod.GoogleGenerativeAI(apiKey);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const model = genAI.getGenerativeModel({
    model: config.model,
    systemInstruction: systemPrompt,
  });

  const history = messages.slice(0, -1).map((m) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }],
  }));
  const last = messages[messages.length - 1];

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const chat = model.startChat({ history });
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const result = await chat.sendMessage(last?.content ?? '');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const text: string = result.response.text();

  return {
    content: text,
    model: config.model,
  };
}

export async function geminiComplete(
  config: ModelConfig,
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  const resp = await geminiChat(config, systemPrompt, [
    { role: 'user', content: userMessage },
  ]);
  return resp.content;
}

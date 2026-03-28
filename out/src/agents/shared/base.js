import { claudeComplete } from '../../providers/claude/index.js';
import { openaiComplete } from '../../providers/openai/index.js';
import { geminiComplete } from '../../providers/gemini/index.js';
import { claudeChat } from '../../providers/claude/index.js';
import { openaiChat } from '../../providers/openai/index.js';
import { geminiChat } from '../../providers/gemini/index.js';
import { shouldUseClaudeCode, claudeCodeComplete, claudeCodeChat } from '../../providers/claude-code/index.js';
export async function callModel(config, systemPrompt, userMessage) {
    switch (config.provider) {
        case 'claude':
            // OAuth tokens can't call the Messages API directly — use Claude Code subprocess
            if (shouldUseClaudeCode()) {
                return claudeCodeComplete(config, systemPrompt, userMessage);
            }
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
export async function callModelWithMessages(config, systemPrompt, messages) {
    switch (config.provider) {
        case 'claude': {
            // OAuth tokens can't call the Messages API directly — use Claude Code subprocess
            if (shouldUseClaudeCode()) {
                const resp = await claudeCodeChat(config, systemPrompt, messages);
                return resp.content;
            }
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
export function parseJsonFromResponse(raw) {
    // Try extracting from markdown code block first
    const fenced = raw.match(/```(?:json)?\s*([\s\S]+?)```/);
    const jsonStr = fenced ? fenced[1] : raw;
    try {
        return JSON.parse(jsonStr.trim());
    }
    catch {
        throw new Error(`Failed to parse JSON from model response:\n${raw.slice(0, 500)}`);
    }
}
//# sourceMappingURL=base.js.map
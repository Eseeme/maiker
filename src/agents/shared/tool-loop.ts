/**
 * Unified Agent Tool Loop
 *
 * Provider-agnostic tool execution cycle:
 *   1. Send messages + tool definitions to the model
 *   2. Model responds with text and/or tool calls
 *   3. Execute each tool call on disk (with security guards)
 *   4. Send tool results back to the model
 *   5. Repeat until the model stops calling tools
 *
 * Supports all providers:
 *   - Claude: native tool_use via Anthropic Messages API
 *   - OpenAI: function calling via Chat Completions API
 *   - Gemini: function calling via Generative AI API
 *   - pi-mono: JSON-based structured output (single-shot, no multi-turn tools)
 *   - Claude Code subprocess: OAuth fallback with scoped permissions
 */

import type { ModelConfig } from '../../types/index.js';
import { AGENT_TOOLS, executeTool } from './tools.js';
import type { ToolResult } from './tools.js';
import type { SecurityPolicy } from '../../core/guards/index.js';
import type { PolicyHooks } from '../../core/hooks/index.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ToolLoopOptions {
  /** Model config (provider + model name) */
  modelConfig: ModelConfig;
  /** System prompt for the agent */
  systemPrompt: string;
  /** Initial user message */
  userMessage: string;
  /** Project root — tools resolve paths relative to this */
  projectPath: string;
  /** Max tool-call rounds before forcing stop (default: 30) */
  maxRounds?: number;
  /** Called each time a tool is executed */
  onToolCall?: (toolName: string, input: Record<string, string>, result: ToolResult) => void;
  /** Security policy for tool execution guards */
  securityPolicy?: SecurityPolicy;
  /** Deterministic policy hooks for pre/post action enforcement */
  hooks?: PolicyHooks;
}

export interface ToolLoopResult {
  /** Final text response from the model */
  finalText: string;
  /** All files that were written during the loop */
  changedFiles: string[];
  /** Total tool calls made */
  toolCallCount: number;
}

/** Provider-agnostic representation of a tool call from any model */
interface ToolCall {
  id: string;
  name: string;
  input: Record<string, string>;
}

// ─── Unified entry point ─────────────────────────────────────────────────────

export async function runToolLoop(opts: ToolLoopOptions): Promise<ToolLoopResult> {
  const { modelConfig } = opts;

  switch (modelConfig.provider) {
    case 'claude':
      return runClaudeToolLoop(opts);
    case 'openai':
      return runOpenAIToolLoop(opts);
    case 'gemini':
      return runGeminiToolLoop(opts);
    case 'pi-mono':
      return runJsonFallbackToolLoop(opts);
    default:
      return runJsonFallbackToolLoop(opts);
  }
}

// ─── Shared tool execution ───────────────────────────────────────────────────

async function executeToolCalls(
  toolCalls: ToolCall[],
  projectPath: string,
  changedFiles: string[],
  securityPolicy?: SecurityPolicy,
  onToolCall?: ToolLoopOptions['onToolCall'],
  hooks?: PolicyHooks,
): Promise<Array<{ id: string; output: string; isError: boolean }>> {
  const results: Array<{ id: string; output: string; isError: boolean }> = [];

  for (const tc of toolCalls) {
    const result = await executeTool(tc.name, tc.input, projectPath, securityPolicy, hooks);

    if (tc.name === 'write_file' && !result.isError) {
      const path = tc.input.path;
      if (!changedFiles.includes(path)) {
        changedFiles.push(path);
      }
    }

    if (onToolCall) {
      onToolCall(tc.name, tc.input, result);
    }

    results.push({ id: tc.id, output: result.output, isError: result.isError });
  }

  return results;
}

// ─── Claude Tool Loop ────────────────────────────────────────────────────────

async function runClaudeToolLoop(opts: ToolLoopOptions): Promise<ToolLoopResult> {
  const { modelConfig, systemPrompt, userMessage, projectPath } = opts;
  const maxRounds = opts.maxRounds ?? 30;

  // OAuth tokens can't call the Messages API directly — use Claude Code subprocess
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  if (apiKey.startsWith('sk-ant-oat')) {
    const { claudeCodeComplete, isClaudeCodeAvailable } = await import('../../providers/claude-code/index.js');
    if (isClaudeCodeAvailable()) {
      console.log('    [tool-loop] Using Claude Code subprocess (OAuth detected)');
      const result = await claudeCodeComplete(
        modelConfig, systemPrompt, userMessage, projectPath, undefined, opts.securityPolicy,
      );
      return { finalText: result, changedFiles: [], toolCallCount: 0 };
    }
    throw new Error(
      'OAuth token detected but Claude Code CLI is not available. ' +
      'Install Claude Code or set a direct ANTHROPIC_API_KEY (not sk-ant-oat*).'
    );
  }

  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey });
  const changedFiles: string[] = [];
  let toolCallCount = 0;

  type MessageParam = import('@anthropic-ai/sdk').Anthropic.MessageParam;
  type ToolResultBlockParam = import('@anthropic-ai/sdk').Anthropic.ToolResultBlockParam;
  type Tool = import('@anthropic-ai/sdk').Anthropic.Tool;

  const messages: MessageParam[] = [
    { role: 'user', content: userMessage },
  ];

  for (let round = 0; round < maxRounds; round++) {
    const response = await client.messages.create({
      model: modelConfig.model,
      max_tokens: modelConfig.maxTokens ?? 16384,
      system: systemPrompt,
      tools: AGENT_TOOLS as Tool[],
      messages,
    });

    const textBlocks: string[] = [];
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        textBlocks.push(block.text);
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, string>,
        });
      }
    }

    if (toolCalls.length === 0) {
      return { finalText: textBlocks.join('\n'), changedFiles, toolCallCount };
    }

    // Execute tools
    const results = await executeToolCalls(
      toolCalls, projectPath, changedFiles, opts.securityPolicy, opts.onToolCall, opts.hooks,
    );
    toolCallCount += results.length;

    const toolResults: ToolResultBlockParam[] = results.map(r => ({
      type: 'tool_result' as const,
      tool_use_id: r.id,
      content: r.output,
      is_error: r.isError,
    }));

    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });

    if (response.stop_reason === 'end_turn') {
      return { finalText: textBlocks.join('\n'), changedFiles, toolCallCount };
    }
  }

  return {
    finalText: `(stopped after ${maxRounds} tool-call rounds)`,
    changedFiles,
    toolCallCount,
  };
}

// ─── OpenAI Tool Loop ────────────────────────────────────────────────────────

/** Convert our tool definitions to OpenAI function calling format */
function toOpenAITools() {
  return AGENT_TOOLS.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object',
        properties: t.input_schema.properties,
        required: t.input_schema.required,
      },
    },
  }));
}

async function runOpenAIToolLoop(opts: ToolLoopOptions): Promise<ToolLoopResult> {
  const { modelConfig, systemPrompt, userMessage, projectPath } = opts;
  const maxRounds = opts.maxRounds ?? 30;

  let OpenAI: typeof import('openai').default;
  try {
    OpenAI = (await import('openai')).default;
  } catch {
    throw new Error('openai package not installed. Run: npm install openai');
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set.');
  const client = new OpenAI({ apiKey });

  const changedFiles: string[] = [];
  let toolCallCount = 0;
  const tools = toOpenAITools();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  for (let round = 0; round < maxRounds; round++) {
    const response = await (client as any).chat.completions.create({
      model: modelConfig.model,
      max_tokens: modelConfig.maxTokens ?? 16384,
      messages,
      tools,
    });

    const choice = response.choices[0];
    const assistantMsg = choice.message;

    // Collect text
    const text = assistantMsg.content ?? '';

    // Check for tool calls
    const openaiToolCalls = assistantMsg.tool_calls ?? [];

    if (openaiToolCalls.length === 0) {
      return { finalText: text, changedFiles, toolCallCount };
    }

    // Parse tool calls into our unified format
    const toolCalls: ToolCall[] = openaiToolCalls.map((tc: any) => ({
      id: tc.id,
      name: tc.function.name,
      input: JSON.parse(tc.function.arguments),
    }));

    // Execute tools
    const results = await executeToolCalls(
      toolCalls, projectPath, changedFiles, opts.securityPolicy, opts.onToolCall, opts.hooks,
    );
    toolCallCount += results.length;

    // Add assistant message with tool calls to history
    messages.push(assistantMsg);

    // Add tool results
    for (const result of results) {
      messages.push({
        role: 'tool',
        tool_call_id: result.id,
        content: result.output,
      });
    }

    if (choice.finish_reason === 'stop') {
      return { finalText: text, changedFiles, toolCallCount };
    }
  }

  return {
    finalText: `(stopped after ${maxRounds} tool-call rounds)`,
    changedFiles,
    toolCallCount,
  };
}

// ─── Gemini Tool Loop ────────────────────────────────────────────────────────

/** Convert our tool definitions to Gemini function declaration format */
function toGeminiFunctionDeclarations() {
  return AGENT_TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    parameters: {
      type: 'OBJECT',
      properties: Object.fromEntries(
        Object.entries(t.input_schema.properties).map(([k, v]) => [
          k,
          { type: 'STRING', description: (v as any).description },
        ]),
      ),
      required: t.input_schema.required,
    },
  }));
}

async function runGeminiToolLoop(opts: ToolLoopOptions): Promise<ToolLoopResult> {
  const { modelConfig, systemPrompt, userMessage, projectPath } = opts;
  const maxRounds = opts.maxRounds ?? 30;

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_API_KEY is not set.');

  // Dynamic import to avoid requiring the package at startup
  let mod: any;
  try {
    mod = await (new Function('m', 'return import(m)'))('@google/generative-ai');
  } catch {
    throw new Error('@google/generative-ai package not installed. Run: npm install @google/generative-ai');
  }

  const genAI = new mod.GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelConfig.model,
    systemInstruction: systemPrompt,
    generationConfig: modelConfig.maxTokens ? { maxOutputTokens: modelConfig.maxTokens } : undefined,
    tools: [{ functionDeclarations: toGeminiFunctionDeclarations() }],
  });

  const changedFiles: string[] = [];
  let toolCallCount = 0;

  const chat = model.startChat();
  let result = await chat.sendMessage(userMessage);

  for (let round = 0; round < maxRounds; round++) {
    const response = result.response;
    const candidate = response.candidates?.[0];
    if (!candidate) break;

    // Extract function calls from the response
    const functionCalls: ToolCall[] = [];
    const textParts: string[] = [];

    for (const part of candidate.content?.parts ?? []) {
      if (part.functionCall) {
        functionCalls.push({
          id: `gemini-${round}-${functionCalls.length}`,
          name: part.functionCall.name,
          input: (part.functionCall.args ?? {}) as Record<string, string>,
        });
      } else if (part.text) {
        textParts.push(part.text);
      }
    }

    if (functionCalls.length === 0) {
      return { finalText: textParts.join('\n'), changedFiles, toolCallCount };
    }

    // Execute tools
    const results = await executeToolCalls(
      functionCalls, projectPath, changedFiles, opts.securityPolicy, opts.onToolCall,
    );
    toolCallCount += results.length;

    // Send function responses back to Gemini
    const functionResponses = functionCalls.map((fc, i) => ({
      functionResponse: {
        name: fc.name,
        response: { content: results[i].output, isError: results[i].isError },
      },
    }));

    result = await chat.sendMessage(functionResponses);
  }

  // Extract final text from last response
  const finalParts = result.response.candidates?.[0]?.content?.parts ?? [];
  const finalText = finalParts.map((p: any) => p.text ?? '').join('\n');

  return {
    finalText: finalText || `(completed after ${toolCallCount} tool calls)`,
    changedFiles,
    toolCallCount,
  };
}

// ─── JSON Fallback (pi-mono and unknown providers) ───────────────────────────

/**
 * For providers that don't support function calling, we use a structured
 * JSON protocol: model returns actions as JSON, we execute them, then
 * send results back for the next turn.
 */
async function runJsonFallbackToolLoop(opts: ToolLoopOptions): Promise<ToolLoopResult> {
  const { modelConfig, systemPrompt, userMessage, projectPath } = opts;
  const maxRounds = opts.maxRounds ?? 10; // Lower default for JSON mode

  const { callModelWithMessages } = await import('./base.js');
  type LLMMessage = import('../../providers/claude/index.js').LLMMessage;

  const toolDocs = AGENT_TOOLS.map(t =>
    `- ${t.name}(${t.input_schema.required.join(', ')}): ${t.description}`
  ).join('\n');

  const augmentedSystem = `${systemPrompt}

You have these tools available — to call them, return a JSON object:
${toolDocs}

When you need to use a tool, respond with ONLY a JSON object:
{"tool_calls": [{"name": "tool_name", "input": {"param": "value"}}]}

When you are done (no more tools needed), respond with ONLY:
{"done": true, "summary": "what you did", "changedFiles": ["file1.ts"]}

Rules:
- Call ONE or MORE tools per turn
- After each tool turn, you'll receive the results and can call more tools
- When finished, return the done object
- Do NOT mix tool calls with the done response`;

  const changedFiles: string[] = [];
  let toolCallCount = 0;
  const messages: LLMMessage[] = [
    { role: 'user', content: userMessage },
  ];

  for (let round = 0; round < maxRounds; round++) {
    const raw = await callModelWithMessages(modelConfig, augmentedSystem, messages);

    // Try to parse as JSON
    let parsed: any;
    try {
      const fenced = raw.match(/```(?:json)?\s*([\s\S]+?)```/);
      parsed = JSON.parse((fenced ? fenced[1] : raw).trim());
    } catch {
      // Model returned plain text — treat as final response
      return { finalText: raw, changedFiles, toolCallCount };
    }

    // Check if model says it's done
    if (parsed.done) {
      if (parsed.changedFiles) {
        for (const f of parsed.changedFiles) {
          if (!changedFiles.includes(f)) changedFiles.push(f);
        }
      }
      return {
        finalText: parsed.summary ?? raw,
        changedFiles,
        toolCallCount,
      };
    }

    // Extract tool calls
    const calls = parsed.tool_calls ?? [];
    if (calls.length === 0) {
      return { finalText: raw, changedFiles, toolCallCount };
    }

    const toolCalls: ToolCall[] = calls.map((c: any, i: number) => ({
      id: `json-${round}-${i}`,
      name: c.name,
      input: c.input ?? {},
    }));

    const results = await executeToolCalls(
      toolCalls, projectPath, changedFiles, opts.securityPolicy, opts.onToolCall, opts.hooks,
    );
    toolCallCount += results.length;

    // Add assistant response and tool results to message history
    messages.push({ role: 'assistant', content: raw });

    const resultSummary = results.map((r, i) => {
      const tc = toolCalls[i];
      return `Tool: ${tc.name}\nResult${r.isError ? ' (ERROR)' : ''}:\n${r.output}`;
    }).join('\n\n---\n\n');

    messages.push({
      role: 'user',
      content: `Tool execution results:\n\n${resultSummary}\n\nContinue with more tool calls or return {"done": true, "summary": "..."} when finished.`,
    });
  }

  return {
    finalText: `(stopped after ${maxRounds} tool-call rounds)`,
    changedFiles,
    toolCallCount,
  };
}

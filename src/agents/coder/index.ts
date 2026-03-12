import type {
  CodeAgentInput,
  CodeAgentOutput,
  MaikerConfig,
} from '../../types/index.js';
import { runToolLoop } from '../shared/tool-loop.js';
import { callModel, parseJsonFromResponse } from '../shared/base.js';

const TOOL_SYSTEM_PROMPT = `You are the Code Agent for mAIker.
You have tools to read files, write files, list directories, and run commands.

Your job:
1. Read the existing project to understand the codebase
2. Implement the subtask by writing/modifying actual files
3. Use write_file to create or update each file
4. Verify your work (e.g., list the directory to confirm files were created)

Rules:
- Implement ONLY the current subtask
- Respect no-touch constraints and acceptance criteria
- Prefer minimal blast radius — change only what's needed
- Do not refactor unrelated files
- Do not weaken tests to make them pass
- Actually write the files — do not just describe what you would do

When you are finished writing all files, respond with a brief summary of what you implemented.`;

const FALLBACK_SYSTEM_PROMPT = `You are the Code Agent for mAIker.
Implement only the current subtask.
Respect no-touch constraints and acceptance criteria.
Prefer minimal blast radius.
Do not refactor unrelated files.
Do not weaken tests to make them pass.

Return a JSON object with this exact shape:
{
  "changedFiles": ["string"],
  "implementationNotes": "string describing what was changed and why",
  "riskNotes": "string describing any risks introduced"
}

Return ONLY the JSON object.`;

export async function runCodeAgent(
  input: CodeAgentInput,
  config: MaikerConfig,
): Promise<CodeAgentOutput> {
  const modelConfig = config.models.codeGeneration;

  const userMessage = buildUserMessage(input);

  // Use tool loop for Claude — actually writes files to disk
  if (modelConfig.provider === 'claude') {
    const result = await runToolLoop({
      modelConfig,
      systemPrompt: TOOL_SYSTEM_PROMPT,
      userMessage,
      projectPath: input.projectPath,
      onToolCall: (name, toolInput) => {
        if (name === 'write_file') {
          console.log(`    [coder] write: ${toolInput.path}`);
        } else if (name === 'read_file') {
          console.log(`    [coder] read: ${toolInput.path}`);
        } else if (name === 'run_command') {
          console.log(`    [coder] run: ${toolInput.command}`);
        }
      },
    });

    return {
      changedFiles: result.changedFiles,
      implementationNotes: result.finalText || `Created ${result.changedFiles.length} file(s) with ${result.toolCallCount} tool calls`,
      riskNotes: '',
    };
  }

  // Fallback for non-Claude providers — returns JSON plan (no tool use)
  const raw = await callModel(modelConfig, FALLBACK_SYSTEM_PROMPT, userMessage);
  return parseJsonFromResponse<CodeAgentOutput>(raw);
}

function buildUserMessage(input: CodeAgentInput): string {
  return `
Goal: ${input.goal}
Project: ${input.projectPath}

Current Subtask:
ID: ${input.subtask.id}
Title: ${input.subtask.title}
Description: ${input.subtask.description}

File Targets:
${input.fileTargets.join('\n') || 'Not specified — use your best judgment'}

Acceptance Criteria:
${input.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}

No-Touch Constraints:
${input.noTouchConstraints.map((c) => `- ${c}`).join('\n') || 'None specified'}

Repository Context:
${input.repoContext}

Additional Context:
${input.context ?? 'None'}

${input.sharedContext && input.sharedContext.completedNotes.length > 0 ? `
Previously Completed Subtasks (context from parallel execution):
${input.sharedContext.completedNotes.map(n => `- [${n.subtaskId}] ${n.title}: ${n.notes}`).join('\n')}

Files already changed by other subtasks:
${input.sharedContext.changedFiles.join('\n') || 'None yet'}
` : ''}

Implement the subtask now. Use the tools to read existing files, then write your changes.
`.trim();
}

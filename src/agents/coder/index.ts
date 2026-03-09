import type {
  CodeAgentInput,
  CodeAgentOutput,
  MaikerConfig,
} from '../../types/index.js';
import { callModel, parseJsonFromResponse } from '../shared/base.js';

const SYSTEM_PROMPT = `You are the Code Agent for mAIker.
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
  const userMessage = `
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

Implement the subtask and return the result as JSON.
`.trim();

  const modelConfig = config.models.codeGeneration;
  const raw = await callModel(modelConfig, SYSTEM_PROMPT, userMessage);
  return parseJsonFromResponse<CodeAgentOutput>(raw);
}

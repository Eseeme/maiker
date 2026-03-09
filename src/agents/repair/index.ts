import type {
  RepairAgentInput,
  RepairAgentOutput,
  MaikerConfig,
} from '../../types/index.js';
import { callModel, parseJsonFromResponse } from '../shared/base.js';

const SYSTEM_PROMPT = `You are the Repair Agent for mAIker.
You are receiving structured validator failures for a specific subtask.
Apply the smallest safe patch that resolves the issue without introducing regressions.

Rules:
- only change relevant files
- do not redesign unless necessary
- preserve approved behavior
- do not remove assertions to make tests pass
- use evidence as the source of truth
- check the "issueAttempts" to see how many times each issue has been tried
- if this is attempt 2+, try a DIFFERENT approach than previous attempts
- check "priorRepairNotes" to see what was already tried and avoid repeating

Return a JSON object with this exact shape:
{
  "patchPlan": "string describing the minimal patch to apply",
  "changedFiles": ["string"],
  "expectedImpact": "string describing what should be fixed",
  "residualRisk": "string describing remaining risks"
}

Return ONLY the JSON object.`;

export async function runRepairAgent(
  input: RepairAgentInput,
  config: MaikerConfig,
): Promise<RepairAgentOutput> {
  const userMessage = `
Goal: ${input.goal}
Project: ${input.projectPath}

Open Issues:
${JSON.stringify(input.issues, null, 2)}

Validator Evidence:
${input.validatorEvidence}

Touched Files:
${input.touchedFiles.join('\n') || 'None recorded'}

Prior Repair Attempts (total): ${input.priorAttempts}

Per-Issue Attempt Counts:
${Object.entries(input.issueAttempts).map(([id, n]) => `- ${id}: attempt ${n}`).join('\n') || 'First attempt for all'}

Previous Repair Notes (what was already tried):
${input.priorRepairNotes.length > 0 ? input.priorRepairNotes.map((n, i) => `[attempt ${i + 1}] ${n}`).join('\n') : 'No prior attempts'}

Additional Context:
${input.context ?? 'None'}

Produce a minimal repair plan and return it as JSON.
`.trim();

  const modelConfig = config.models.repairAgent;
  const raw = await callModel(modelConfig, SYSTEM_PROMPT, userMessage);
  return parseJsonFromResponse<RepairAgentOutput>(raw);
}

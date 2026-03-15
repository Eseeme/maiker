import type {
  RepairAgentInput,
  RepairAgentOutput,
  MaikerConfig,
} from '../../types/index.js';
import { runToolLoop } from '../shared/tool-loop.js';
import { callModel, parseJsonFromResponse } from '../shared/base.js';
import fs from 'fs-extra';
import { resolve, dirname } from 'path';

const TOOL_SYSTEM_PROMPT = `You are the Repair Agent for mAIker.
You have tools to read files, write files, list directories, and run commands.

You are receiving structured validator failures. Your job:
1. Read the failing files to understand the problem
2. Apply the smallest safe patch that resolves each issue
3. Use write_file to apply your fixes
4. Optionally run the failing command to verify your fix

Rules:
- Only change relevant files
- Do not redesign unless necessary
- Preserve approved behavior
- Do not remove assertions to make tests pass
- Use the validator evidence as the source of truth
- Check "issueAttempts" — if this is attempt 2+, try a DIFFERENT approach
- Check "priorRepairNotes" to see what was already tried and avoid repeating

When done, respond with a brief summary of what you fixed.`;

const FALLBACK_SYSTEM_PROMPT = `You are the Repair Agent for mAIker.
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

You MUST return the COMPLETE file contents for every file you modify.

Return a JSON object with this exact shape:
{
  "patchPlan": "string describing the minimal patch to apply",
  "changedFiles": ["relative/path/to/file.ts"],
  "files": [
    {
      "path": "relative/path/to/file.ts",
      "content": "the FULL file content to write to disk"
    }
  ],
  "expectedImpact": "string describing what should be fixed",
  "residualRisk": "string describing remaining risks"
}

IMPORTANT:
- "files" must contain one entry for every path listed in "changedFiles"
- "content" must be the COMPLETE file content, not a diff or partial snippet
- Return ONLY the JSON object.`;

export async function runRepairAgent(
  input: RepairAgentInput,
  config: MaikerConfig,
): Promise<RepairAgentOutput> {
  const modelConfig = config.models.repairAgent;

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

Read the failing files, apply minimal fixes, and verify if possible.
`.trim();

  // Use tool loop for Claude — actually fixes files on disk
  if (modelConfig.provider === 'claude') {
    const result = await runToolLoop({
      modelConfig,
      systemPrompt: TOOL_SYSTEM_PROMPT,
      userMessage,
      projectPath: input.projectPath,
      onToolCall: (name, toolInput) => {
        if (name === 'write_file') {
          console.log(`    [repair] write: ${toolInput.path}`);
        } else if (name === 'run_command') {
          console.log(`    [repair] run: ${toolInput.command}`);
        }
      },
    });

    return {
      patchPlan: result.finalText || `Applied fixes to ${result.changedFiles.length} file(s)`,
      changedFiles: result.changedFiles,
      expectedImpact: 'Issues should be resolved by the applied patches',
      residualRisk: '',
    };
  }

  // Fallback for non-Claude providers — parse JSON and write files to disk
  const raw = await callModel(modelConfig, FALLBACK_SYSTEM_PROMPT, userMessage);
  const parsed = parseJsonFromResponse<RepairAgentOutput & { files?: { path: string; content: string }[] }>(raw);

  if (parsed.files && parsed.files.length > 0) {
    for (const file of parsed.files) {
      const filePath = resolve(input.projectPath, file.path);
      await fs.ensureDir(dirname(filePath));
      await fs.writeFile(filePath, file.content, 'utf-8');
      console.log(`    [repair] write: ${file.path}`);
    }
  }

  return {
    patchPlan: parsed.patchPlan,
    changedFiles: parsed.changedFiles,
    expectedImpact: parsed.expectedImpact,
    residualRisk: parsed.residualRisk,
  };
}

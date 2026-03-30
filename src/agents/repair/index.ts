import type {
  RepairAgentInput,
  RepairAgentOutput,
  MaikerConfig,
} from '../../types/index.js';
import { runToolLoop } from '../shared/tool-loop.js';
import type { SecurityPolicy } from '../../core/guards/index.js';
import { DEFAULT_SECURITY_POLICY } from '../../core/guards/index.js';
import { createHooks } from '../../core/hooks/index.js';
import {
  getRepairStrategy,
  formatRepairHistory,
  type RepairAttemptRecord,
} from '../../core/policies/index.js';

const BASE_SYSTEM_PROMPT = `You are the Repair Agent for mAIker.
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
- Review the repair history carefully to avoid repeating failed approaches

When done, respond with a brief summary of what you fixed.`;

export async function runRepairAgent(
  input: RepairAgentInput,
  config: MaikerConfig,
): Promise<RepairAgentOutput> {
  // Determine the current attempt number for strategy selection
  const maxAttempt = Math.max(
    input.priorAttempts,
    ...Object.values(input.issueAttempts).map(Number),
    0,
  );
  const currentAttempt = maxAttempt + 1;

  // Get the escalating strategy for this attempt
  const strategyConfig = getRepairStrategy(currentAttempt);

  // Select model: use alternate model on attempt 4+ if available
  let modelConfig = config.models.repairAgent;
  if (strategyConfig.alternateModelKey && config.models[strategyConfig.alternateModelKey]) {
    modelConfig = config.models[strategyConfig.alternateModelKey];
    console.log(`    [repair] Using alternate model: ${modelConfig.provider}/${modelConfig.model} (strategy: ${strategyConfig.strategy})`);
  }

  // Apply temperature override if strategy calls for it
  if (strategyConfig.temperature !== undefined) {
    modelConfig = { ...modelConfig, temperature: strategyConfig.temperature };
  }

  const securityPolicy: SecurityPolicy = config.policies.security ?? DEFAULT_SECURITY_POLICY;
  const hooks = createHooks(config, input.projectPath);

  // Build the strategy-augmented system prompt
  const systemPrompt = `${BASE_SYSTEM_PROMPT}

${strategyConfig.strategyPrompt}`;

  // Format structured repair history
  const structuredHistory: RepairAttemptRecord[] = input.priorRepairNotes.map((note, i) => ({
    attemptNumber: i + 1,
    strategy: getRepairStrategy(i + 1).strategy,
    issueId: 'unknown',
    patchPlan: note,
    changedFiles: [],
    outcome: 'still_failing' as const,
    description: note,
  }));

  const userMessage = `
Goal: ${input.goal}
Project: ${input.projectPath}

Current Repair Strategy: ${strategyConfig.strategy.toUpperCase()} (attempt ${currentAttempt})

Open Issues:
${JSON.stringify(input.issues, null, 2)}

Validator Evidence:
${input.validatorEvidence}

Touched Files:
${input.touchedFiles.join('\n') || 'None recorded'}

Per-Issue Attempt Counts:
${Object.entries(input.issueAttempts).map(([id, n]) => `- ${id}: attempt ${n}`).join('\n') || 'First attempt for all'}

Repair History (what was tried and failed):
${formatRepairHistory(structuredHistory)}

Additional Context:
${input.context ?? 'None'}

Read the failing files, apply fixes using the ${strategyConfig.strategy.toUpperCase()} strategy, and verify if possible.
`.trim();

  console.log(`    [repair] Strategy: ${strategyConfig.strategy} (attempt ${currentAttempt})`);

  // All providers go through the unified tool loop
  const result = await runToolLoop({
    modelConfig,
    systemPrompt,
    userMessage,
    projectPath: input.projectPath,
    securityPolicy,
    hooks,
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
    expectedImpact: `Strategy: ${strategyConfig.strategy}. Issues should be resolved.`,
    residualRisk: currentAttempt >= 3 ? 'Multiple repair attempts — review changes carefully.' : '',
  };
}

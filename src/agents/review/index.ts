import type {
  PostApprovalReviewAgentInput,
  PostApprovalReviewAgentOutput,
  MaikerConfig,
} from '../../types/index.js';
import { callModel, parseJsonFromResponse } from '../shared/base.js';

const SYSTEM_PROMPT = `You are the Post-Approval Review Agent for mAIker.
Your job is to detect hidden regressions, scope drift, suspicious code churn, brittle tests, and overfitted fixes after human approval.

Focus on:
- unrelated logic changes
- accidental regressions
- dead code
- fragile selectors
- broad layout changes with unclear blast radius
- tests that assert existence instead of behavior

Return a JSON object with this exact shape:
{
  "regressionFindings": ["string"],
  "scopeDriftFindings": ["string"],
  "suspiciousChurnFindings": ["string"],
  "overallRisk": "low|medium|high|critical",
  "summary": "string"
}

Return ONLY the JSON object.`;

export async function runPostApprovalReviewAgent(
  input: PostApprovalReviewAgentInput,
  config: MaikerConfig,
): Promise<PostApprovalReviewAgentOutput> {
  const userMessage = `
Goal: ${input.goal}
Project: ${input.projectPath}

Diff Summary:
${input.diffSummary}

Tests Modified:
${input.testsModified.join('\n') || 'None'}

Touched Files:
${input.touchedFiles.join('\n')}

Validation History:
${JSON.stringify(input.validationHistory, null, 2)}

Context:
${input.context ?? 'None'}

Review for hidden regressions and scope drift. Return findings as JSON.
`.trim();

  const modelConfig = config.models.postApprovalReview;
  const raw = await callModel(modelConfig, SYSTEM_PROMPT, userMessage);
  return parseJsonFromResponse<PostApprovalReviewAgentOutput>(raw);
}

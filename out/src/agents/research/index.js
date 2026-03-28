import { callModel, parseJsonFromResponse } from '../shared/base.js';
const SYSTEM_PROMPT = `You are the Research Agent for mAIker.
Your job is to transform raw user goals, repository signals, documents, and constraints into a normalized brief.

Return a JSON object with this exact shape:
{
  "objective": "string",
  "functionalRequirements": ["string"],
  "nonFunctionalRequirements": ["string"],
  "uxConstraints": ["string"],
  "forbiddenPatterns": ["string"],
  "assumptions": ["string"],
  "openQuestions": ["string"],
  "evidenceRefs": ["string"]
}

Do not generate code.
Do not skip ambiguities.
Resolve ambiguity conservatively.
Return ONLY the JSON object.`;
export async function runResearchAgent(input, config) {
    const userMessage = `
Goal: ${input.goal}
Project: ${input.projectPath}

Repository Summary:
${input.repoSummary}

Constraints:
${(input.constraints ?? []).join('\n') || 'None specified'}

References:
${(input.references ?? []).join('\n') || 'None'}

Additional Context:
${input.context ?? 'None'}

Produce a normalized brief as JSON.
`.trim();
    const modelConfig = config.models.researchIngestion;
    const raw = await callModel(modelConfig, SYSTEM_PROMPT, userMessage);
    return parseJsonFromResponse(raw);
}
//# sourceMappingURL=index.js.map
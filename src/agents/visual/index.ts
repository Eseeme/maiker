import type {
  VisualReviewAgentInput,
  VisualReviewAgentOutput,
  MaikerConfig,
  Issue,
} from '../../types/index.js';
import { callModel, parseJsonFromResponse } from '../shared/base.js';
import { v4 as uuidv4 } from 'uuid';

const SYSTEM_PROMPT = `You are the Visual Review Agent for mAIker.
Analyze screenshots and evidence against explicit UX and layout constraints.

Check for:
- overflow or content clipping
- hidden navigation elements
- broken sticky or floating elements
- mobile table unusability
- spacing and hierarchy defects
- violations of stated constraints

Return a JSON object with this exact shape:
{
  "issues": [
    {
      "id": "layout-NNN",
      "category": "layout|behavior|performance|accessibility|other",
      "severity": "low|medium|high|critical",
      "stage": "VALIDATE_VISUAL",
      "page": "/path",
      "viewport": "WxH",
      "selector": "css-selector or null",
      "observed": "what was seen",
      "expected": "what should be seen",
      "repairHint": "suggested fix",
      "status": "open",
      "attempts": 0,
      "createdAt": "ISO timestamp",
      "evidenceRefs": ["path/to/screenshot.png"]
    }
  ],
  "evidenceRefs": ["string"],
  "summary": "string"
}

Return structured findings only. Return ONLY the JSON object.`;

export async function runVisualReviewAgent(
  input: VisualReviewAgentInput,
  config: MaikerConfig,
): Promise<VisualReviewAgentOutput> {
  const now = new Date().toISOString();

  const userMessage = `
Goal: ${input.goal}
Project: ${input.projectPath}

Screenshots captured:
${input.screenshotPaths.join('\n') || 'No screenshots available'}

Viewports tested:
${input.viewports.join(', ')}

Task constraints:
${input.taskConstraints.map((c) => `- ${c}`).join('\n') || 'None specified'}

Route metadata:
${JSON.stringify(input.routeMetadata, null, 2)}

Context:
${input.context ?? 'None'}

Analyze the visual evidence and return structured findings as JSON.
`.trim();

  const modelConfig = config.models.visualReview;
  const raw = await callModel(modelConfig, SYSTEM_PROMPT, userMessage);
  const parsed = parseJsonFromResponse<VisualReviewAgentOutput>(raw);

  // Ensure all issues have required fields
  const issues: Issue[] = (parsed.issues ?? []).map((issue) => ({
    id: issue.id || `layout-${uuidv4().split('-')[0]}`,
    category: issue.category ?? 'layout',
    severity: issue.severity ?? 'medium',
    stage: 'VALIDATE_VISUAL' as const,
    page: issue.page,
    viewport: issue.viewport,
    selector: issue.selector,
    observed: issue.observed ?? '',
    expected: issue.expected ?? '',
    repairHint: issue.repairHint,
    status: 'open' as const,
    attempts: 0,
    createdAt: now,
    evidenceRefs: issue.evidenceRefs ?? [],
  }));

  return {
    issues,
    evidenceRefs: parsed.evidenceRefs ?? input.screenshotPaths,
    summary: parsed.summary ?? 'Visual review completed.',
  };
}

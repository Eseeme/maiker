import type {
  PlannerAgentInput,
  PlannerAgentOutput,
  MaikerConfig,
  ExecutionPlan,
  TaskClassification,
  ValidationProfile,
} from '../../types/index.js';
import { callModel, parseJsonFromResponse } from '../shared/base.js';

const SYSTEM_PROMPT = `You are the Planner Agent for mAIker.
Your job is to classify the task, define subtasks with a dependency graph, identify likely files or modules affected, and generate a validation profile.

IMPORTANT — Parallel Execution:
Subtasks will be executed IN PARALLEL when they have no dependencies on each other.
Use the "dependsOn" field to declare which subtasks must complete before this one can start.
If two subtasks touch the SAME file, they MUST have a dependency relationship.
Subtasks with no dependsOn (or empty array) run immediately and concurrently.

Return a JSON object with this exact shape:
{
  "classification": {
    "taskType": "mobile-responsive-redesign|framework-upgrade|feature-work|bugfix|refactor|unknown",
    "riskLevel": "low|medium|high|critical",
    "affectedAreas": ["string"],
    "noTouchZones": ["string"],
    "estimatedComplexity": "simple|moderate|complex"
  },
  "plan": {
    "classification": { ... same as above ... },
    "subtasks": [
      {
        "id": "subtask-1",
        "title": "string",
        "description": "string",
        "fileTargets": ["string"],
        "acceptanceCriteria": ["string"],
        "order": 1,
        "dependsOn": []
      },
      {
        "id": "subtask-2",
        "title": "string",
        "description": "string",
        "fileTargets": ["string"],
        "acceptanceCriteria": ["string"],
        "order": 2,
        "dependsOn": ["subtask-1"]
      }
    ],
    "acceptanceCriteria": ["string"],
    "validationProfile": {
      "taskType": "string",
      "required": ["build","lint","typecheck","playwright_e2e","screenshot_capture","visual_review"],
      "optional": ["accessibility"],
      "skipped": []
    },
    "fileTargetHints": ["string"],
    "riskList": ["string"],
    "assumptions": ["string"]
  }
}

Return ONLY the JSON object.`;

export async function runPlannerAgent(
  input: PlannerAgentInput,
  config: MaikerConfig,
): Promise<PlannerAgentOutput> {
  const userMessage = `
Goal: ${input.goal}
Project: ${input.projectPath}

Brief:
${JSON.stringify(input.brief, null, 2)}

Repository Inspection:
Framework: ${input.inspection.framework}
Package Manager: ${input.inspection.packageManager}
Test Framework: ${input.inspection.testFramework}
Has TypeScript: ${input.inspection.hasTypeScript}
Has Playwright: ${input.inspection.hasPlaywright}
Routes: ${input.inspection.routes.join(', ')}
Hotspots: ${input.inspection.hotspots.join(', ')}

Constraints:
${(input.constraints ?? []).join('\n') || 'None specified'}

Generate a detailed execution plan.
`.trim();

  const modelConfig = config.models.planner;
  const raw = await callModel(modelConfig, SYSTEM_PROMPT, userMessage);
  return parseJsonFromResponse<PlannerAgentOutput>(raw);
}

// ─── Fallback plan (when AI is unavailable) ───────────────────────────────────

export function buildFallbackPlan(
  goal: string,
  classification: TaskClassification,
): ExecutionPlan {
  const validationProfile: ValidationProfile = {
    taskType: classification.taskType,
    required: ['build', 'lint', 'typecheck'],
    optional: ['playwright_e2e', 'screenshot_capture'],
    skipped: [],
  };

  return {
    classification,
    subtasks: [
      {
        id: 'subtask-1',
        title: 'Implement changes',
        description: goal,
        fileTargets: [],
        acceptanceCriteria: ['All validators pass'],
        order: 1,
        dependsOn: [],
      },
    ],
    acceptanceCriteria: ['All validators pass', 'No regressions'],
    validationProfile,
    fileTargetHints: [],
    riskList: ['Unknown scope'],
    assumptions: ['Using fallback plan due to planner unavailability'],
  };
}

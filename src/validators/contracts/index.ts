import { z } from 'zod';

// ─── Issue Schema ─────────────────────────────────────────────────────────────

export const IssueSchema = z.object({
  id: z.string(),
  category: z.enum(['layout', 'behavior', 'performance', 'accessibility', 'build', 'test', 'type', 'lint', 'other']),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  stage: z.string(),
  page: z.string().optional(),
  viewport: z.string().optional(),
  selector: z.string().optional(),
  observed: z.string(),
  expected: z.string(),
  repairHint: z.string().optional(),
  status: z.enum(['open', 'resolved', 'escalated', 'wont_fix']),
  attempts: z.number().int().min(0),
  createdAt: z.string(),
  resolvedAt: z.string().optional(),
  evidenceRefs: z.array(z.string()).optional(),
});

export const ValidationResultSchema = z.object({
  stage: z.enum(['deterministic', 'visual']),
  results: z.array(z.object({
    name: z.string(),
    status: z.enum(['pending', 'running', 'passed', 'failed', 'skipped']),
    duration: z.number().optional(),
    output: z.string().optional(),
    error: z.string().optional(),
    artifacts: z.array(z.string()).optional(),
  })),
  passed: z.boolean(),
  failedCount: z.number(),
  startedAt: z.string(),
  completedAt: z.string(),
});

export const RunStateSchema = z.object({
  runId: z.string(),
  projectPath: z.string(),
  goal: z.string(),
  status: z.enum(['pending', 'running', 'paused', 'done', 'failed', 'blocked']),
  currentStage: z.string(),
  currentAgent: z.string().optional(),
  currentAction: z.string().optional(),
  retryCounts: z.record(z.number()),
  openIssues: z.array(z.string()),
  resolvedIssues: z.array(z.string()),
  contextUpdates: z.array(z.object({
    id: z.string(),
    message: z.string(),
    impact: z.enum(['low', 'medium', 'high']),
    action: z.string(),
    addedAt: z.string(),
  })),
  createdAt: z.string(),
  lastUpdatedAt: z.string(),
  completedAt: z.string().optional(),
});

export function validateIssue(data: unknown) {
  return IssueSchema.safeParse(data);
}

export function validateRunState(data: unknown) {
  return RunStateSchema.safeParse(data);
}

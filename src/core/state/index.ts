import fs from 'fs-extra';
import { resolve, join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import type {
  RunState,
  JobSpec,
  WorkflowStage,
  RunStatus,
  Issue,
  ContextUpdate,
  ValidationResult,
  TaskClassification,
  ExecutionPlan,
  RepoInspection,
  ContextImpact,
} from '../../types/index.js';

export const RUNS_DIR = '.maiker/runs';

export function generateRunId(): string {
  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19);
  const short = uuidv4().split('-')[0];
  return `mk-${ts}-${short}`;
}

export function getRunDir(runId: string, baseDir: string = RUNS_DIR): string {
  return resolve(join(baseDir, runId));
}

// ─── Run Folder Initialisation ────────────────────────────────────────────────

export async function initRunFolder(
  runId: string,
  goal: string,
  projectPath: string,
  configPath: string,
  baseDir: string = RUNS_DIR,
): Promise<string> {
  const dir = getRunDir(runId, baseDir);
  await fs.ensureDir(dir);
  await fs.ensureDir(join(dir, 'artifacts', 'screenshots'));
  await fs.ensureDir(join(dir, 'artifacts', 'traces'));
  await fs.ensureDir(join(dir, 'artifacts', 'logs'));
  await fs.ensureDir(join(dir, 'artifacts', 'diffs'));
  await fs.ensureDir(join(dir, 'artifacts', 'reports'));
  await fs.ensureDir(join(dir, 'issues'));
  await fs.ensureDir(join(dir, 'review'));
  await fs.ensureDir(join(dir, 'final'));

  const now = new Date().toISOString();

  const job: JobSpec = {
    runId,
    goal,
    projectPath,
    configPath,
    flags: {},
    createdAt: now,
  };
  await fs.writeJson(join(dir, 'job.json'), job, { spaces: 2 });

  const state: RunState = {
    runId,
    projectPath,
    goal,
    status: 'pending',
    currentStage: 'INIT',
    retryCounts: {},
    openIssues: [],
    resolvedIssues: [],
    contextUpdates: [],
    createdAt: now,
    lastUpdatedAt: now,
  };
  await fs.writeJson(join(dir, 'state.json'), state, { spaces: 2 });

  // Initialise empty issue stores
  await fs.writeJson(join(dir, 'issues', 'open.json'), [], { spaces: 2 });
  await fs.writeJson(join(dir, 'issues', 'resolved.json'), [], { spaces: 2 });
  await fs.writeJson(join(dir, 'issues', 'escalated.json'), [], { spaces: 2 });

  return dir;
}

// ─── State Reads ──────────────────────────────────────────────────────────────

export async function loadRunState(
  runId: string,
  baseDir: string = RUNS_DIR,
): Promise<RunState> {
  const dir = getRunDir(runId, baseDir);
  const statePath = join(dir, 'state.json');
  if (!(await fs.pathExists(statePath))) {
    throw new Error(`Run state not found for runId: ${runId}`);
  }
  return fs.readJson(statePath) as Promise<RunState>;
}

export async function loadJobSpec(
  runId: string,
  baseDir: string = RUNS_DIR,
): Promise<JobSpec> {
  const dir = getRunDir(runId, baseDir);
  return fs.readJson(join(dir, 'job.json')) as Promise<JobSpec>;
}

// ─── State Write Mutex ───────────────────────────────────────────────────────
// Prevents race conditions when parallel subtasks (Promise.allSettled) write
// state concurrently. Each runId gets its own serialised queue.

const stateMutexes = new Map<string, Promise<unknown>>();

async function withStateLock<T>(runId: string, fn: () => Promise<T>): Promise<T> {
  const prev = stateMutexes.get(runId) ?? Promise.resolve();
  const next = prev.then(fn, fn); // always run fn, even if prior rejected
  stateMutexes.set(runId, next);
  // Clean up after settling to avoid memory leak
  next.finally(() => {
    if (stateMutexes.get(runId) === next) stateMutexes.delete(runId);
  });
  return next;
}

// ─── State Writes ─────────────────────────────────────────────────────────────

export async function updateRunState(
  runId: string,
  patch: Partial<RunState>,
  baseDir: string = RUNS_DIR,
): Promise<RunState> {
  return withStateLock(runId, async () => {
    const current = await loadRunState(runId, baseDir);
    const updated: RunState = {
      ...current,
      ...patch,
      lastUpdatedAt: new Date().toISOString(),
    };
    const dir = getRunDir(runId, baseDir);
    await fs.writeJson(join(dir, 'state.json'), updated, { spaces: 2 });
    return updated;
  });
}

export async function setStage(
  runId: string,
  stage: WorkflowStage,
  baseDir: string = RUNS_DIR,
): Promise<void> {
  await updateRunState(runId, { currentStage: stage }, baseDir);
}

export async function setStatus(
  runId: string,
  status: RunStatus,
  baseDir: string = RUNS_DIR,
): Promise<void> {
  await updateRunState(runId, { status }, baseDir);
}

export async function setAgent(
  runId: string,
  agent: string,
  action: string,
  baseDir: string = RUNS_DIR,
): Promise<void> {
  await updateRunState(
    runId,
    { currentAgent: agent, currentAction: action },
    baseDir,
  );
}

export async function incrementRetry(
  runId: string,
  key: string,
  baseDir: string = RUNS_DIR,
): Promise<number> {
  const state = await loadRunState(runId, baseDir);
  const count = (state.retryCounts[key] ?? 0) + 1;
  await updateRunState(
    runId,
    { retryCounts: { ...state.retryCounts, [key]: count } },
    baseDir,
  );
  return count;
}

export async function saveInspection(
  runId: string,
  inspection: RepoInspection,
  baseDir: string = RUNS_DIR,
): Promise<void> {
  await updateRunState(runId, { inspection }, baseDir);
  const dir = getRunDir(runId, baseDir);
  await fs.writeJson(join(dir, 'inspection.json'), inspection, { spaces: 2 });
}

export async function saveClassification(
  runId: string,
  classification: TaskClassification,
  baseDir: string = RUNS_DIR,
): Promise<void> {
  await updateRunState(runId, { classification }, baseDir);
  const dir = getRunDir(runId, baseDir);
  await fs.writeJson(join(dir, 'classification.json'), classification, {
    spaces: 2,
  });
}

export async function savePlan(
  runId: string,
  plan: ExecutionPlan,
  baseDir: string = RUNS_DIR,
): Promise<void> {
  await updateRunState(runId, { plan }, baseDir);
  const dir = getRunDir(runId, baseDir);
  await fs.writeJson(join(dir, 'plan.json'), plan, { spaces: 2 });
  // Also write readable markdown
  const md = planToMarkdown(plan);
  await fs.writeFile(join(dir, 'plan.md'), md);
}

function planToMarkdown(plan: ExecutionPlan): string {
  const lines: string[] = [
    `# Execution Plan`,
    ``,
    `## Classification`,
    `- Task type: ${plan.classification.taskType}`,
    `- Risk: ${plan.classification.riskLevel}`,
    `- Complexity: ${plan.classification.estimatedComplexity}`,
    ``,
    `## Subtasks`,
  ];
  for (const sub of plan.subtasks) {
    lines.push(``, `### ${sub.order}. ${sub.title}`, `${sub.description}`);
    if (sub.fileTargets.length > 0) {
      lines.push(`**Files:** ${sub.fileTargets.join(', ')}`);
    }
    lines.push(
      `**Acceptance:** ${sub.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}`,
    );
  }
  lines.push(``, `## Acceptance Criteria`);
  for (const c of plan.acceptanceCriteria) lines.push(`- ${c}`);
  lines.push(``, `## Risks`);
  for (const r of plan.riskList) lines.push(`- ${r}`);
  return lines.join('\n');
}

// ─── Issue Management ─────────────────────────────────────────────────────────

export async function addIssue(
  runId: string,
  issue: Issue,
  baseDir: string = RUNS_DIR,
): Promise<void> {
  const dir = getRunDir(runId, baseDir);
  const openPath = join(dir, 'issues', 'open.json');
  const issues: Issue[] = await fs.readJson(openPath);
  issues.push(issue);
  await fs.writeJson(openPath, issues, { spaces: 2 });
  const state = await loadRunState(runId, baseDir);
  await updateRunState(
    runId,
    { openIssues: [...state.openIssues, issue.id] },
    baseDir,
  );
}

export async function resolveIssue(
  runId: string,
  issueId: string,
  baseDir: string = RUNS_DIR,
): Promise<void> {
  const dir = getRunDir(runId, baseDir);
  const openPath = join(dir, 'issues', 'open.json');
  const resolvedPath = join(dir, 'issues', 'resolved.json');

  const open: Issue[] = await fs.readJson(openPath);
  const idx = open.findIndex((i) => i.id === issueId);
  if (idx === -1) return;

  const [issue] = open.splice(idx, 1);
  issue.status = 'resolved';
  issue.resolvedAt = new Date().toISOString();

  await fs.writeJson(openPath, open, { spaces: 2 });
  const resolved: Issue[] = await fs.readJson(resolvedPath);
  resolved.push(issue);
  await fs.writeJson(resolvedPath, resolved, { spaces: 2 });

  const state = await loadRunState(runId, baseDir);
  await updateRunState(
    runId,
    {
      openIssues: state.openIssues.filter((id) => id !== issueId),
      resolvedIssues: [...state.resolvedIssues, issueId],
    },
    baseDir,
  );
}

export async function getOpenIssues(
  runId: string,
  baseDir: string = RUNS_DIR,
): Promise<Issue[]> {
  const dir = getRunDir(runId, baseDir);
  return fs.readJson(join(dir, 'issues', 'open.json')) as Promise<Issue[]>;
}

// ─── Context Updates ──────────────────────────────────────────────────────────

export async function addContextUpdate(
  runId: string,
  message: string,
  impact: ContextImpact,
  baseDir: string = RUNS_DIR,
): Promise<ContextUpdate> {
  const update: ContextUpdate = {
    id: uuidv4(),
    message,
    impact,
    action:
      impact === 'low'
        ? 'continue'
        : impact === 'medium'
          ? 'rerun_current_stage'
          : 'replan_downstream',
    addedAt: new Date().toISOString(),
  };
  const state = await loadRunState(runId, baseDir);
  await updateRunState(
    runId,
    { contextUpdates: [...state.contextUpdates, update] },
    baseDir,
  );
  return update;
}

export async function getContextUpdates(
  runId: string,
  baseDir: string = RUNS_DIR,
): Promise<ContextUpdate[]> {
  const state = await loadRunState(runId, baseDir);
  return state.contextUpdates;
}

// ─── Validation Results ───────────────────────────────────────────────────────

export async function appendValidationResult(
  runId: string,
  result: ValidationResult,
  baseDir: string = RUNS_DIR,
): Promise<void> {
  const state = await loadRunState(runId, baseDir);
  const prev = state.validationResults ?? [];
  await updateRunState(runId, { validationResults: [...prev, result] }, baseDir);
  const dir = getRunDir(runId, baseDir);
  await fs.writeJson(
    join(dir, `artifacts/reports/validation-${Date.now()}.json`),
    result,
    { spaces: 2 },
  );
}

// ─── Run Discovery ────────────────────────────────────────────────────────────

export async function listRuns(baseDir: string = RUNS_DIR): Promise<RunState[]> {
  if (!(await fs.pathExists(baseDir))) return [];
  const dirs = await fs.readdir(baseDir);
  const states: RunState[] = [];
  for (const d of dirs) {
    const statePath = join(baseDir, d, 'state.json');
    if (await fs.pathExists(statePath)) {
      try {
        const s = (await fs.readJson(statePath)) as RunState;
        states.push(s);
      } catch {
        // skip corrupt state files
      }
    }
  }
  return states.sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export async function getLatestRun(
  baseDir: string = RUNS_DIR,
): Promise<RunState | null> {
  const runs = await listRuns(baseDir);
  return runs[0] ?? null;
}

export async function findRun(
  runIdOrPartial: string,
  baseDir: string = RUNS_DIR,
): Promise<RunState | null> {
  const runs = await listRuns(baseDir);
  return (
    runs.find(
      (r) =>
        r.runId === runIdOrPartial || r.runId.startsWith(runIdOrPartial),
    ) ?? null
  );
}

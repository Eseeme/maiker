import fs from 'fs-extra';
import { resolve, join } from 'path';
import { v4 as uuidv4 } from 'uuid';
export const RUNS_DIR = '.maiker/runs';
export function generateRunId() {
    const ts = new Date()
        .toISOString()
        .replace(/[:.]/g, '-')
        .replace('T', '_')
        .slice(0, 19);
    const short = uuidv4().split('-')[0];
    return `mk-${ts}-${short}`;
}
export function getRunDir(runId, baseDir = RUNS_DIR) {
    return resolve(join(baseDir, runId));
}
// ─── Run Folder Initialisation ────────────────────────────────────────────────
export async function initRunFolder(runId, goal, projectPath, configPath, baseDir = RUNS_DIR) {
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
    const job = {
        runId,
        goal,
        projectPath,
        configPath,
        flags: {},
        createdAt: now,
    };
    await fs.writeJson(join(dir, 'job.json'), job, { spaces: 2 });
    const state = {
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
export async function loadRunState(runId, baseDir = RUNS_DIR) {
    const dir = getRunDir(runId, baseDir);
    const statePath = join(dir, 'state.json');
    if (!(await fs.pathExists(statePath))) {
        throw new Error(`Run state not found for runId: ${runId}`);
    }
    return fs.readJson(statePath);
}
export async function loadJobSpec(runId, baseDir = RUNS_DIR) {
    const dir = getRunDir(runId, baseDir);
    return fs.readJson(join(dir, 'job.json'));
}
// ─── State Write Mutex ───────────────────────────────────────────────────────
// Prevents race conditions when parallel subtasks (Promise.allSettled) write
// state concurrently. Each runId gets its own serialised queue.
const stateMutexes = new Map();
async function withStateLock(runId, fn) {
    const prev = stateMutexes.get(runId) ?? Promise.resolve();
    const next = prev.then(fn, fn); // always run fn, even if prior rejected
    stateMutexes.set(runId, next);
    // Clean up after settling to avoid memory leak
    next.finally(() => {
        if (stateMutexes.get(runId) === next)
            stateMutexes.delete(runId);
    });
    return next;
}
// ─── State Writes ─────────────────────────────────────────────────────────────
export async function updateRunState(runId, patch, baseDir = RUNS_DIR) {
    return withStateLock(runId, async () => {
        const current = await loadRunState(runId, baseDir);
        const updated = {
            ...current,
            ...patch,
            lastUpdatedAt: new Date().toISOString(),
        };
        const dir = getRunDir(runId, baseDir);
        await fs.writeJson(join(dir, 'state.json'), updated, { spaces: 2 });
        return updated;
    });
}
export async function setStage(runId, stage, baseDir = RUNS_DIR) {
    await updateRunState(runId, { currentStage: stage }, baseDir);
}
export async function setStatus(runId, status, baseDir = RUNS_DIR) {
    await updateRunState(runId, { status }, baseDir);
}
export async function setAgent(runId, agent, action, baseDir = RUNS_DIR) {
    await updateRunState(runId, { currentAgent: agent, currentAction: action }, baseDir);
}
export async function incrementRetry(runId, key, baseDir = RUNS_DIR) {
    const state = await loadRunState(runId, baseDir);
    const count = (state.retryCounts[key] ?? 0) + 1;
    await updateRunState(runId, { retryCounts: { ...state.retryCounts, [key]: count } }, baseDir);
    return count;
}
export async function saveInspection(runId, inspection, baseDir = RUNS_DIR) {
    await updateRunState(runId, { inspection }, baseDir);
    const dir = getRunDir(runId, baseDir);
    await fs.writeJson(join(dir, 'inspection.json'), inspection, { spaces: 2 });
}
export async function saveClassification(runId, classification, baseDir = RUNS_DIR) {
    await updateRunState(runId, { classification }, baseDir);
    const dir = getRunDir(runId, baseDir);
    await fs.writeJson(join(dir, 'classification.json'), classification, {
        spaces: 2,
    });
}
export async function savePlan(runId, plan, baseDir = RUNS_DIR) {
    await updateRunState(runId, { plan }, baseDir);
    const dir = getRunDir(runId, baseDir);
    await fs.writeJson(join(dir, 'plan.json'), plan, { spaces: 2 });
    // Also write readable markdown
    const md = planToMarkdown(plan);
    await fs.writeFile(join(dir, 'plan.md'), md);
}
function planToMarkdown(plan) {
    const lines = [
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
        lines.push(`**Acceptance:** ${sub.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}`);
    }
    lines.push(``, `## Acceptance Criteria`);
    for (const c of plan.acceptanceCriteria)
        lines.push(`- ${c}`);
    lines.push(``, `## Risks`);
    for (const r of plan.riskList)
        lines.push(`- ${r}`);
    return lines.join('\n');
}
// ─── Issue Management ─────────────────────────────────────────────────────────
export async function addIssue(runId, issue, baseDir = RUNS_DIR) {
    const dir = getRunDir(runId, baseDir);
    const openPath = join(dir, 'issues', 'open.json');
    const issues = await fs.readJson(openPath);
    issues.push(issue);
    await fs.writeJson(openPath, issues, { spaces: 2 });
    const state = await loadRunState(runId, baseDir);
    await updateRunState(runId, { openIssues: [...state.openIssues, issue.id] }, baseDir);
}
export async function resolveIssue(runId, issueId, baseDir = RUNS_DIR) {
    const dir = getRunDir(runId, baseDir);
    const openPath = join(dir, 'issues', 'open.json');
    const resolvedPath = join(dir, 'issues', 'resolved.json');
    const open = await fs.readJson(openPath);
    const idx = open.findIndex((i) => i.id === issueId);
    if (idx === -1)
        return;
    const [issue] = open.splice(idx, 1);
    issue.status = 'resolved';
    issue.resolvedAt = new Date().toISOString();
    await fs.writeJson(openPath, open, { spaces: 2 });
    const resolved = await fs.readJson(resolvedPath);
    resolved.push(issue);
    await fs.writeJson(resolvedPath, resolved, { spaces: 2 });
    const state = await loadRunState(runId, baseDir);
    await updateRunState(runId, {
        openIssues: state.openIssues.filter((id) => id !== issueId),
        resolvedIssues: [...state.resolvedIssues, issueId],
    }, baseDir);
}
export async function getOpenIssues(runId, baseDir = RUNS_DIR) {
    const dir = getRunDir(runId, baseDir);
    return fs.readJson(join(dir, 'issues', 'open.json'));
}
// ─── Context Updates ──────────────────────────────────────────────────────────
export async function addContextUpdate(runId, message, impact, baseDir = RUNS_DIR) {
    const update = {
        id: uuidv4(),
        message,
        impact,
        action: impact === 'low'
            ? 'continue'
            : impact === 'medium'
                ? 'rerun_current_stage'
                : 'replan_downstream',
        addedAt: new Date().toISOString(),
    };
    const state = await loadRunState(runId, baseDir);
    await updateRunState(runId, { contextUpdates: [...state.contextUpdates, update] }, baseDir);
    return update;
}
export async function getContextUpdates(runId, baseDir = RUNS_DIR) {
    const state = await loadRunState(runId, baseDir);
    return state.contextUpdates;
}
// ─── Validation Results ───────────────────────────────────────────────────────
export async function appendValidationResult(runId, result, baseDir = RUNS_DIR) {
    const state = await loadRunState(runId, baseDir);
    const prev = state.validationResults ?? [];
    await updateRunState(runId, { validationResults: [...prev, result] }, baseDir);
    const dir = getRunDir(runId, baseDir);
    await fs.writeJson(join(dir, `artifacts/reports/validation-${Date.now()}.json`), result, { spaces: 2 });
}
// ─── Run Discovery ────────────────────────────────────────────────────────────
export async function listRuns(baseDir = RUNS_DIR) {
    if (!(await fs.pathExists(baseDir)))
        return [];
    const dirs = await fs.readdir(baseDir);
    const states = [];
    for (const d of dirs) {
        const statePath = join(baseDir, d, 'state.json');
        if (await fs.pathExists(statePath)) {
            try {
                const s = (await fs.readJson(statePath));
                states.push(s);
            }
            catch {
                // skip corrupt state files
            }
        }
    }
    return states.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
export async function getLatestRun(baseDir = RUNS_DIR) {
    const runs = await listRuns(baseDir);
    return runs[0] ?? null;
}
export async function findRun(runIdOrPartial, baseDir = RUNS_DIR) {
    const runs = await listRuns(baseDir);
    return (runs.find((r) => r.runId === runIdOrPartial || r.runId.startsWith(runIdOrPartial)) ?? null);
}
//# sourceMappingURL=index.js.map
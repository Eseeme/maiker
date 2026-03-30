/**
 * mAIker Workflow Orchestrator — Powered by LangGraph
 *
 * Uses LangGraph's StateGraph for the workflow state machine:
 * - Annotation for typed, reducible state
 * - Conditional edges for routing decisions
 * - Promise.allSettled for parallel subtask fan-out within waves
 * - SqliteSaver for durable checkpointing (.maiker/checkpoints.db) and cross-process resume
 * - interrupt() for human-in-the-loop escalation
 *
 * Stage flow:
 *   INSPECT → CLASSIFY → PLAN → EXECUTE (parallel via Promise.allSettled)
 *   EXECUTE → VALIDATE_DETERMINISTIC → VALIDATE_VISUAL
 *   VALIDATE → pass → POST_APPROVAL_REVIEW → PROMOTE → END
 *   VALIDATE → fail → REPAIR → VALIDATE (retry loop)
 *   REPAIR → budget exceeded → HUMAN_ESCALATION (interrupt)
 */

import {
  StateGraph,
  Annotation,
  interrupt,
  Command,
  END,
  START,
} from '@langchain/langgraph';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';

import type {
  WorkflowInput,
  WorkflowStage,
  MaikerConfig,
  Issue,
  Subtask,
  SubtaskState,
  SharedContext,
  ValidationResult,
  ContextUpdate,
  RepoInspection,
  TaskClassification,
  ExecutionPlan,
  ValidatorName,
  RunStatus,
} from '../../types/index.js';
import { classifyError } from '../../types/index.js';
import {
  initRunFolder,
  updateRunState,
  setStage,
  setStatus,
  setAgent,
  saveInspection,
  saveClassification,
  savePlan,
  appendValidationResult,
  addIssue,
  resolveIssue,
  incrementRetry,
  getOpenIssues,
} from '../state/index.js';
import {
  emitRunStarted,
  emitRunCompleted,
  emitRunFailed,
  emitStageStarted,
  emitStageCompleted,
  emitAgentInvoked,
  emitAgentCompleted,
  emitRepairStarted,
  emitRepairCompleted,
  emitEscalationTriggered,
  eventBus,
} from '../../artifacts/events.js';
import { inspectRepo, classifyTask } from '../classification/index.js';
import { runResearchAgent } from '../../agents/research/index.js';
import { runPlannerAgent, buildFallbackPlan } from '../../agents/planner/index.js';
import { runRepairAgent } from '../../agents/repair/index.js';
import { runPostApprovalReviewAgent } from '../../agents/review/index.js';
import { getValidationProfile, shouldEscalate, shouldAutoReplan, getRepairStrategy } from '../policies/index.js';
import { runFullValidation } from '../../validators/engine/index.js';
import { summariseRepo } from '../../tools/filesystem/index.js';
import {
  getFullDiff,
  isGitRepo,
  createCheckpoint,
  removeCheckpoint,
  createWorktree,
  removeWorktree,
  stageAll,
  commit,
  getCurrentCommit,
} from '../../tools/git/index.js';
import { writeEscalationPacket, saveFinalSummary } from '../../artifacts/index.js';
import { v4 as uuidv4 } from 'uuid';

// ─── LangGraph State Definition ──────────────────────────────────────────────

/** Reducer: merge arrays by concatenation (for issues, validationResults, etc.) */
function arrayReducer<T>(existing: T[], incoming: T[]): T[] {
  return [...existing, ...incoming];
}

/** Reducer: merge records by shallow spread */
function recordReducer<V>(existing: Record<string, V>, incoming: Record<string, V>): Record<string, V> {
  return { ...existing, ...incoming };
}

/**
 * The LangGraph state annotation.
 * Each field can have a reducer so that parallel nodes can write
 * to the same key without overwriting each other's work.
 */
const WorkflowState = Annotation.Root({
  // ── Identity ─────────────────────────
  runId:       Annotation<string>(),
  projectPath: Annotation<string>(),
  goal:        Annotation<string>(),
  config:      Annotation<MaikerConfig>(),
  dryRun:      Annotation<boolean>(),

  // ── Stage tracking ───────────────────
  stage:  Annotation<WorkflowStage>(),
  status: Annotation<RunStatus>(),
  error:  Annotation<string | undefined>(),

  // ── Pipeline data ────────────────────
  inspection:     Annotation<RepoInspection | undefined>(),
  classification: Annotation<TaskClassification | undefined>(),
  plan:           Annotation<ExecutionPlan | undefined>(),

  // ── Execution state ──────────────────
  currentSubtaskIndex: Annotation<number>(),

  // Parallel subtask results (reducer: merge from parallel Send nodes)
  subtaskStates: Annotation<Record<string, SubtaskState>>({
    value: recordReducer,
    default: () => ({}),
  }),

  // Shared context accumulated across waves
  sharedContext: Annotation<SharedContext>({
    value: (_prev, next) => next, // latest wins (each wave builds on prior)
    default: () => ({ changedFiles: [], completedNotes: [] }),
  }),

  // ── Validation & issues ──────────────
  validationResults: Annotation<ValidationResult[]>({
    value: arrayReducer,
    default: () => [],
  }),

  issues: Annotation<Issue[]>({
    value: (_prev, next) => next, // always take the latest full list
    default: () => [],
  }),

  // ── Repair tracking ──────────────────
  retryCounts: Annotation<Record<string, number>>({
    value: recordReducer,
    default: () => ({}),
  }),
  repairHistory: Annotation<string[]>({
    value: arrayReducer,
    default: () => [],
  }),
  previousFailureCount: Annotation<number | undefined>(),

  // ── Context & decisions ──────────────
  contextUpdates: Annotation<ContextUpdate[]>({
    value: arrayReducer,
    default: () => [],
  }),
  humanDecision: Annotation<'proceed' | 'replan' | 'abort' | undefined>(),
});

type GraphState = typeof WorkflowState.State;

// ─── Subtask execution state (used with Send for parallel fan-out) ──────────

// SubtaskExecState is defined for documentation — actual parallel
// execution happens via Promise.allSettled within the execute node,
// which is more practical for wave-based dependency ordering.

// ─── Parallel Execution Helpers ──────────────────────────────────────────────

function computeExecutionWaves(subtasks: Subtask[]): Subtask[][] {
  const byId = new Map(subtasks.map(s => [s.id, s]));
  const completed = new Set<string>();
  const remaining = new Set(subtasks.map(s => s.id));
  const waves: Subtask[][] = [];
  let maxIterations = subtasks.length + 1;

  while (remaining.size > 0 && maxIterations-- > 0) {
    const wave: Subtask[] = [];
    for (const id of remaining) {
      const task = byId.get(id)!;
      if (task.dependsOn.every(dep => completed.has(dep))) {
        wave.push(task);
      }
    }
    if (wave.length === 0) {
      console.warn('[maiker] Circular dependency detected, forcing remaining into final wave');
      waves.push([...remaining].map(id => byId.get(id)!));
      break;
    }
    waves.push(wave);
    for (const task of wave) {
      completed.add(task.id);
      remaining.delete(task.id);
    }
  }
  return waves;
}

function detectFileConflicts(wave: Subtask[]): Array<[string, string]> {
  const conflicts: Array<[string, string]> = [];
  for (let i = 0; i < wave.length; i++) {
    for (let j = i + 1; j < wave.length; j++) {
      // Direct file overlap
      const shared = wave[i].fileTargets.filter(f => wave[j].fileTargets.includes(f));
      if (shared.length > 0) {
        conflicts.push([wave[i].id, wave[j].id]);
        continue;
      }
      // Semantic proximity: if both subtasks target files in the same directory,
      // they're likely touching related modules (shared imports, types, etc.)
      const dirsI = new Set(wave[i].fileTargets.map(f => f.split('/').slice(0, -1).join('/')));
      const dirsJ = new Set(wave[j].fileTargets.map(f => f.split('/').slice(0, -1).join('/')));
      for (const dir of dirsI) {
        if (dir && dirsJ.has(dir)) {
          conflicts.push([wave[i].id, wave[j].id]);
          break;
        }
      }
    }
  }
  return conflicts;
}

/**
 * Check if git worktree isolation is available and safe to use.
 * Requires: git repo, no uncommitted changes (checkpoint handles this).
 */
async function canUseWorktrees(projectPath: string): Promise<boolean> {
  try {
    if (!await isGitRepo(projectPath)) return false;
    // Worktrees need a clean working directory to branch from
    return true;
  } catch {
    return false;
  }
}

import { join } from 'path';
import { tmpdir } from 'os';
import { runCommand } from '../../tools/shell/index.js';

/**
 * Execute a subtask in an isolated git worktree.
 * Returns the changed files and notes.
 *
 * The worktree directory is cleaned up after execution, but the BRANCH is
 * preserved so mergeWorktreeChanges() can cherry-pick from it later.
 * Caller must call cleanupWorktreeBranch() after merge is done.
 */
async function executeInWorktree(
  subtask: Subtask,
  state: GraphState,
  plan: ExecutionPlan,
  cachedRepoContext: string,
  sharedContext: SharedContext,
): Promise<{ changedFiles: string[]; implementationNotes: string }> {
  const branchName = `maiker/${state.runId}/${subtask.id}`;
  const worktreePath = join(tmpdir(), `maiker-wt-${state.runId}-${subtask.id}`);

  try {
    // Create isolated worktree with its own branch
    await createWorktree(state.projectPath, branchName, worktreePath);
    console.log(`    [worktree] Created: ${worktreePath} (branch: ${branchName})`);

    // Run the code agent in the worktree's isolated directory
    const { runCodeAgent } = await import('../../agents/coder/index.js');
    const result = await runCodeAgent({
      runId: state.runId,
      goal: state.goal,
      projectPath: worktreePath, // Agent writes to worktree, not main repo
      subtask,
      acceptanceCriteria: subtask.acceptanceCriteria,
      fileTargets: subtask.fileTargets,
      noTouchConstraints: plan.classification.noTouchZones,
      repoContext: cachedRepoContext,
      context: state.contextUpdates.map(c => c.message).join('\n'),
      sharedContext,
    }, state.config);

    // Commit changes in the worktree so they can be merged back later
    if (result.changedFiles.length > 0) {
      await stageAll(worktreePath);
      await commit(worktreePath, `[maiker] ${subtask.id}: ${subtask.title}`);
    }

    return {
      changedFiles: result.changedFiles,
      implementationNotes: result.implementationNotes,
    };
  } finally {
    // Clean up the worktree directory, but KEEP the branch for merge-back
    try {
      await removeWorktree(state.projectPath, worktreePath);
      console.log(`    [worktree] Removed worktree dir: ${worktreePath} (branch preserved)`);
    } catch (cleanupErr) {
      console.warn(`    [worktree] Cleanup warning: ${String(cleanupErr)}`);
    }
  }
}

/** Clean up a worktree branch after merge-back is complete or abandoned. */
async function cleanupWorktreeBranch(
  projectPath: string,
  branchName: string,
): Promise<void> {
  try {
    await runCommand('git', ['branch', '-D', branchName], { cwd: projectPath });
  } catch { /* branch may already be gone */ }
}

/**
 * Merge a worktree branch's changes into the main working directory.
 * Uses cherry-pick --no-commit to stage changes without a merge commit.
 *
 * On conflict: aborts the cherry-pick cleanly so the repo isn't left
 * in a broken state. Returns success/failure so the caller can decide
 * whether to fall back to sequential re-execution.
 */
async function mergeWorktreeChanges(
  projectPath: string,
  branchName: string,
): Promise<{ success: boolean; error?: string }> {
  // Resolve the branch tip
  const result = await runCommand('git', ['rev-parse', branchName], { cwd: projectPath });
  if (result.exitCode !== 0) {
    return { success: false, error: `Branch not found: ${branchName}` };
  }
  const commitRef = result.stdout.trim();

  // Cherry-pick the commit into the main working directory
  const cpResult = await runCommand('git', ['cherry-pick', commitRef, '--no-commit'], {
    cwd: projectPath,
  });

  if (cpResult.exitCode !== 0) {
    // Abort the cherry-pick to leave the repo in a clean state
    await runCommand('git', ['cherry-pick', '--abort'], { cwd: projectPath });
    return {
      success: false,
      error: `Merge conflict applying ${branchName}: ${cpResult.stderr.slice(0, 200)}`,
    };
  }

  return { success: true };
}

function mapValidatorToCategory(name: ValidatorName | string): Issue['category'] {
  switch (name) {
    case 'build': return 'build';
    case 'lint': return 'lint';
    case 'typecheck': return 'type';
    case 'unit_tests':
    case 'integration_tests':
    case 'regression_tests': return 'test';
    default: return 'other';
  }
}

// ─── Node Implementations ────────────────────────────────────────────────────

async function nodeInspect(state: GraphState): Promise<Partial<GraphState>> {
  emitStageStarted(state.runId, 'INSPECT');
  await setStage(state.runId, 'INSPECT');
  await setAgent(state.runId, 'repo-inspector', 'Scanning repository structure');

  const inspection = await inspectRepo(state.projectPath);
  await saveInspection(state.runId, inspection);
  emitStageCompleted(state.runId, 'INSPECT');
  return { inspection, stage: 'CLASSIFY' as WorkflowStage, status: 'running' as RunStatus };
}

async function nodeClassify(state: GraphState): Promise<Partial<GraphState>> {
  emitStageStarted(state.runId, 'CLASSIFY');
  await setStage(state.runId, 'CLASSIFY');
  await setAgent(state.runId, 'classifier', 'Classifying task type and risk');

  const classification = classifyTask(state.goal);
  await saveClassification(state.runId, classification);
  emitStageCompleted(state.runId, 'CLASSIFY');
  return { classification, stage: 'PLAN' as WorkflowStage, status: 'running' as RunStatus };
}

async function nodePlan(state: GraphState): Promise<Partial<GraphState>> {
  emitStageStarted(state.runId, 'PLAN');
  await setStage(state.runId, 'PLAN');

  const inspection = state.inspection!;
  const classification = state.classification!;
  let plan = buildFallbackPlan(state.goal, classification);

  try {
    emitAgentInvoked(state.runId, 'planner', state.config.models.planner.model);
    await setAgent(state.runId, 'planner', 'Generating execution plan');

    const repoSummary = await summariseRepo(state.projectPath);

    const researchOutput = await runResearchAgent({
      runId: state.runId,
      goal: state.goal,
      projectPath: state.projectPath,
      repoSummary,
      constraints: state.contextUpdates.map(c => c.message),
    }, state.config);

    const plannerOutput = await runPlannerAgent({
      runId: state.runId,
      goal: state.goal,
      projectPath: state.projectPath,
      brief: researchOutput,
      inspection,
      constraints: state.contextUpdates.map(c => c.message),
    }, state.config);

    plan = plannerOutput.plan;
    for (const subtask of plan.subtasks) {
      if (!subtask.dependsOn) subtask.dependsOn = [];
    }
    emitAgentCompleted(state.runId, 'planner');
  } catch (err) {
    const classified = classifyError(err);
    console.warn(`[maiker] Planner agent failed [${classified.category}], using fallback plan: ${classified.message}`);
    plan.assumptions.push(`Fallback plan used (${classified.category}): ${classified.message}`);
    if (classified.category === 'auth') {
      return { plan, stage: 'FAILED' as WorkflowStage, status: 'failed' as RunStatus, error: `Auth error: ${classified.message}` };
    }
  }

  const rawProfile = getValidationProfile(classification);
  // Filter profile by config validators — only run validators the user has enabled
  plan.validationProfile = {
    ...rawProfile,
    required: rawProfile.required.filter(v => state.config.validators[v] !== false),
    optional: rawProfile.optional.filter(v => state.config.validators[v] !== false),
    skipped: [
      ...rawProfile.skipped,
      ...rawProfile.required.filter(v => state.config.validators[v] === false),
      ...rawProfile.optional.filter(v => state.config.validators[v] === false),
    ],
  };
  await savePlan(state.runId, plan);
  emitStageCompleted(state.runId, 'PLAN');

  // Dry run — stop after planning, do not execute changes
  if (state.dryRun) {
    console.log('[maiker] Dry run — plan generated, skipping execution');
    return { plan, stage: 'DONE' as WorkflowStage, status: 'done' as RunStatus };
  }

  return { plan, stage: 'EXECUTE' as WorkflowStage, status: 'running' as RunStatus };
}

/**
 * Execute node — runs subtasks in parallel waves via Promise.allSettled.
 * Waves are computed from the dependency graph (dependsOn fields).
 * Within each wave, independent subtasks run concurrently.
 * File conflicts within a wave cause sequential fallback.
 */
async function nodeExecute(state: GraphState): Promise<Partial<GraphState>> {
  emitStageStarted(state.runId, 'EXECUTE');
  await setStage(state.runId, 'EXECUTE');

  const plan = state.plan!;
  const subtasks = plan.subtasks;

  // Git checkpoint for rollback
  let gitCheckpointRef: string | undefined;
  try {
    if (await isGitRepo(state.projectPath)) {
      gitCheckpointRef = await createCheckpoint(state.projectPath, state.runId);
      console.log(`[maiker] Git checkpoint: ${gitCheckpointRef.slice(0, 8)}`);
    }
  } catch (err) {
    console.warn(`[maiker] Could not create git checkpoint: ${String(err)}`);
  }

  const waves = computeExecutionWaves(subtasks);
  console.log(`[maiker] Execution plan: ${waves.length} wave(s), ${subtasks.length} subtask(s)`);
  for (let i = 0; i < waves.length; i++) {
    console.log(`[maiker]   Wave ${i + 1}: [${waves[i].map(s => s.id).join(', ')}] (${waves[i].length} parallel)`);
  }

  const subtaskStates: Record<string, SubtaskState> = {};
  const sharedContext: SharedContext = {
    changedFiles: state.sharedContext?.changedFiles ?? [],
    completedNotes: state.sharedContext?.completedNotes ?? [],
    gitCheckpointRef,
  };

  // Cache repo context once (avoid redundant summariseRepo calls per subtask)
  const cachedRepoContext = await summariseRepo(state.projectPath);

  // Maximum retries for transient subtask failures (timeout, rate limit, etc.)
  const MAX_SUBTASK_RETRIES = 2;

  // Check if we can use worktree isolation for parallel execution
  const useWorktrees = await canUseWorktrees(state.projectPath);
  if (useWorktrees) {
    console.log('[maiker] Worktree isolation: enabled (parallel subtasks run in isolated copies)');
  } else {
    console.log('[maiker] Worktree isolation: unavailable (not a git repo — using shared directory)');
  }

  // Execute wave by wave
  for (const wave of waves) {
    const conflicts = detectFileConflicts(wave);
    // With worktrees: parallel is safe even with conflicts (isolated directories)
    // Without worktrees: conflicts force sequential execution
    const canParallelize = useWorktrees || conflicts.length === 0;
    const groups = canParallelize ? [wave] : wave.map(s => [s]);

    if (conflicts.length > 0 && useWorktrees) {
      console.log(`[maiker]   File conflicts detected but running parallel (worktree-isolated)`);
    } else if (conflicts.length > 0) {
      console.log(`[maiker]   File conflicts detected — falling back to sequential execution`);
    }

    for (const group of groups) {
      // Run all subtasks in this group in parallel
      const results = await Promise.allSettled(
        group.map(async (subtask) => {
          emitAgentInvoked(state.runId, 'coder', state.config.models.codeGeneration.model);
          await setAgent(state.runId, 'coder', `[${subtask.id}] ${subtask.title}`);

          if (useWorktrees && group.length > 1) {
            // Parallel execution: each subtask gets its own worktree
            const result = await executeInWorktree(
              subtask, state, plan, cachedRepoContext, sharedContext,
            );
            return { subtaskId: subtask.id, result };
          }

          // Sequential or single-subtask: run directly in the project directory
          const { runCodeAgent } = await import('../../agents/coder/index.js');
          const result = await runCodeAgent({
            runId: state.runId,
            goal: state.goal,
            projectPath: state.projectPath,
            subtask,
            acceptanceCriteria: subtask.acceptanceCriteria,
            fileTargets: subtask.fileTargets,
            noTouchConstraints: plan.classification.noTouchZones,
            repoContext: cachedRepoContext,
            context: state.contextUpdates.map(c => c.message).join('\n'),
            sharedContext,
          }, state.config);

          return { subtaskId: subtask.id, result };
        }),
      );

      // Process results → update shared context
      const failedSubtasks: typeof group = [];
      // Track successful worktree branches for post-validation merge
      const worktreeSuccesses: Array<{ subtask: Subtask; result: { changedFiles: string[]; implementationNotes: string } }> = [];

      for (let i = 0; i < group.length; i++) {
        const subtask = group[i];
        const settled = results[i];

        if (settled.status === 'fulfilled') {
          const { result } = settled.value;
          subtaskStates[subtask.id] = {
            subtaskId: subtask.id,
            status: 'completed',
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            changedFiles: result.changedFiles,
            implementationNotes: result.implementationNotes,
          };
          sharedContext.changedFiles.push(...result.changedFiles);
          sharedContext.completedNotes.push({
            subtaskId: subtask.id,
            title: subtask.title,
            notes: result.implementationNotes,
          });
          worktreeSuccesses.push({ subtask, result });
          emitAgentCompleted(state.runId, 'coder');
          console.log(`[maiker] ✓ ${subtask.id}: ${result.implementationNotes}`);
        } else {
          const classified = classifyError(settled.reason);
          console.warn(`[maiker] ✗ ${subtask.id} [${classified.category}]: ${classified.message}`);
          emitAgentCompleted(state.runId, 'coder');

          // Auth errors — abort all execution immediately
          if (classified.category === 'auth') {
            subtaskStates[subtask.id] = {
              subtaskId: subtask.id,
              status: 'failed',
              startedAt: new Date().toISOString(),
              changedFiles: [],
              implementationNotes: '',
              error: `[${classified.category}] ${classified.message}`,
            };
            emitStageCompleted(state.runId, 'EXECUTE');
            return {
              stage: 'FAILED' as WorkflowStage,
              status: 'failed' as RunStatus,
              error: `Auth error during execution: ${classified.message}`,
              subtaskStates,
              sharedContext,
            };
          }

          // Transient errors (timeout, rate limit, connection) — queue for retry
          if (classified.category === 'transient') {
            failedSubtasks.push(subtask);
          } else {
            subtaskStates[subtask.id] = {
              subtaskId: subtask.id,
              status: 'failed',
              startedAt: new Date().toISOString(),
              changedFiles: [],
              implementationNotes: '',
              error: `[${classified.category}] ${classified.message}`,
            };
          }
        }
      }

      // Retry transient failures sequentially (one at a time to reduce load)
      for (const subtask of failedSubtasks) {
        let lastError = '';
        let succeeded = false;

        for (let attempt = 1; attempt <= MAX_SUBTASK_RETRIES; attempt++) {
          const retryKey = `subtask:${subtask.id}`;
          await incrementRetry(state.runId, retryKey);
          console.log(`[maiker] ⟳ Retrying ${subtask.id} (attempt ${attempt}/${MAX_SUBTASK_RETRIES})`);
          emitAgentInvoked(state.runId, 'coder', state.config.models.codeGeneration.model);
          await setAgent(state.runId, 'coder', `[${subtask.id}] retry ${attempt} — ${subtask.title}`);

          try {
            const { runCodeAgent } = await import('../../agents/coder/index.js');
            const result = await runCodeAgent({
              runId: state.runId,
              goal: state.goal,
              projectPath: state.projectPath,
              subtask,
              acceptanceCriteria: subtask.acceptanceCriteria,
              fileTargets: subtask.fileTargets,
              noTouchConstraints: plan.classification.noTouchZones,
              repoContext: cachedRepoContext,
              context: state.contextUpdates.map(c => c.message).join('\n'),
              sharedContext,
            }, state.config);

            subtaskStates[subtask.id] = {
              subtaskId: subtask.id,
              status: 'completed',
              startedAt: new Date().toISOString(),
              completedAt: new Date().toISOString(),
              changedFiles: result.changedFiles,
              implementationNotes: result.implementationNotes,
            };
            sharedContext.changedFiles.push(...result.changedFiles);
            sharedContext.completedNotes.push({
              subtaskId: subtask.id,
              title: subtask.title,
              notes: result.implementationNotes,
            });
            emitAgentCompleted(state.runId, 'coder');
            console.log(`[maiker] ✓ ${subtask.id} (retry ${attempt}): ${result.implementationNotes}`);
            succeeded = true;
            break;
          } catch (retryErr) {
            const retryClassified = classifyError(retryErr);
            lastError = `[${retryClassified.category}] ${retryClassified.message}`;
            console.warn(`[maiker] ✗ ${subtask.id} retry ${attempt} [${retryClassified.category}]: ${retryClassified.message}`);
            emitAgentCompleted(state.runId, 'coder');
          }
        }

        if (!succeeded) {
          subtaskStates[subtask.id] = {
            subtaskId: subtask.id,
            status: 'failed',
            startedAt: new Date().toISOString(),
            changedFiles: [],
            implementationNotes: '',
            error: lastError,
          };
          console.warn(`[maiker] ✗ ${subtask.id} failed after ${MAX_SUBTASK_RETRIES} retries`);
        }
      }

      // Merge worktree results into main working directory
      // When worktrees were used for parallel execution, changes need to be
      // applied to the main repo. Sequential execution writes directly.
      if (useWorktrees && group.length > 1 && worktreeSuccesses.length > 0) {
        console.log(`[maiker] Merging ${worktreeSuccesses.length} worktree result(s) into main directory`);

        // Record pre-merge state so we can rollback all merges if any fails
        const preMergeRef = await getCurrentCommit(state.projectPath).catch(() => '');
        let mergesFailed = false;

        for (const { subtask } of worktreeSuccesses) {
          const branchName = `maiker/${state.runId}/${subtask.id}`;
          const mergeResult = await mergeWorktreeChanges(state.projectPath, branchName);

          if (mergeResult.success) {
            console.log(`[maiker]   ✓ Merged ${subtask.id}`);
          } else {
            console.warn(`[maiker]   ✗ ${subtask.id}: ${mergeResult.error}`);
            mergesFailed = true;

            // Rollback ALL merges in this wave to avoid partial state
            if (preMergeRef) {
              console.warn(`[maiker]   Rolling back all wave merges to pre-merge state`);
              await runCommand('git', ['reset', '--hard', preMergeRef], { cwd: state.projectPath });
            }

            // Clean up all worktree branches before re-execution
            for (const { subtask: s } of worktreeSuccesses) {
              await cleanupWorktreeBranch(state.projectPath, `maiker/${state.runId}/${s.id}`);
            }

            // IMMEDIATE SEQUENTIAL RE-EXECUTION in the main directory
            // This is a deterministic fallback — not routed to the repair loop,
            // because the issue is merge coordination, not implementation quality.
            console.log(`[maiker]   Re-executing wave sequentially in main directory`);
            const waveSubtasks = worktreeSuccesses.map(ws => ws.subtask);
            for (const rerunSubtask of waveSubtasks) {
              emitAgentInvoked(state.runId, 'coder', state.config.models.codeGeneration.model);
              await setAgent(state.runId, 'coder', `[${rerunSubtask.id}] sequential re-exec — ${rerunSubtask.title}`);
              try {
                const { runCodeAgent } = await import('../../agents/coder/index.js');
                const rerunResult = await runCodeAgent({
                  runId: state.runId,
                  goal: state.goal,
                  projectPath: state.projectPath,
                  subtask: rerunSubtask,
                  acceptanceCriteria: rerunSubtask.acceptanceCriteria,
                  fileTargets: rerunSubtask.fileTargets,
                  noTouchConstraints: plan.classification.noTouchZones,
                  repoContext: cachedRepoContext,
                  context: state.contextUpdates.map(c => c.message).join('\n'),
                  sharedContext,
                }, state.config);

                subtaskStates[rerunSubtask.id] = {
                  subtaskId: rerunSubtask.id,
                  status: 'completed',
                  startedAt: new Date().toISOString(),
                  completedAt: new Date().toISOString(),
                  changedFiles: rerunResult.changedFiles,
                  implementationNotes: rerunResult.implementationNotes,
                };
                sharedContext.changedFiles.push(...rerunResult.changedFiles);
                sharedContext.completedNotes.push({
                  subtaskId: rerunSubtask.id,
                  title: rerunSubtask.title,
                  notes: rerunResult.implementationNotes,
                });
                emitAgentCompleted(state.runId, 'coder');
                console.log(`[maiker]   ✓ ${rerunSubtask.id} (sequential): ${rerunResult.implementationNotes}`);
              } catch (rerunErr) {
                const classified = classifyError(rerunErr);
                subtaskStates[rerunSubtask.id] = {
                  subtaskId: rerunSubtask.id,
                  status: 'failed',
                  startedAt: new Date().toISOString(),
                  changedFiles: [],
                  implementationNotes: '',
                  error: `[${classified.category}] ${classified.message}`,
                };
                emitAgentCompleted(state.runId, 'coder');
                console.warn(`[maiker]   ✗ ${rerunSubtask.id} (sequential): ${classified.message}`);
              }
            }

            break; // Exit the merge loop — wave has been re-executed sequentially
          }

          // Clean up the branch after successful merge
          await cleanupWorktreeBranch(state.projectPath, branchName);
        }

        // Commit the successfully merged results (if no rollback happened)
        if (!mergesFailed) {
          try {
            await stageAll(state.projectPath);
            await commit(state.projectPath, `[maiker] Merged wave results for ${state.runId}`);
          } catch {
            // Nothing to commit (all merges were no-ops or empty)
          }
          // Clean up remaining branches
          for (const { subtask: s } of worktreeSuccesses) {
            await cleanupWorktreeBranch(state.projectPath, `maiker/${state.runId}/${s.id}`);
          }
        }
      }
    }
  }

  // Post-execute policy hook: validate all changed files
  const { createHooks } = await import('../hooks/index.js');
  const hooks = createHooks(state.config, state.projectPath, plan.classification.noTouchZones);
  const postCheck = await hooks.postExecute(sharedContext.changedFiles);
  if (!postCheck.passed) {
    console.warn(`[maiker] Post-execute policy violations:`);
    for (const v of postCheck.violations) {
      console.warn(`  - ${v}`);
    }
  }

  emitStageCompleted(state.runId, 'EXECUTE');
  return {
    stage: 'VALIDATE_DETERMINISTIC' as WorkflowStage,
    currentSubtaskIndex: plan.subtasks.length,
    subtaskStates,
    sharedContext,
    status: 'running' as RunStatus,
  };
}

async function nodeValidateDeterministic(state: GraphState): Promise<Partial<GraphState>> {
  emitStageStarted(state.runId, 'VALIDATE_DETERMINISTIC');
  await setStage(state.runId, 'VALIDATE_DETERMINISTIC');
  await setAgent(state.runId, 'validator', 'Running build, lint, typecheck, tests');

  const plan = state.plan!;
  const profile = plan.validationProfile;

  // On re-validation (after repair), only re-run failed validators
  const lastValidation = state.validationResults.length > 0
    ? state.validationResults[state.validationResults.length - 1]
    : undefined;

  const failedValidatorNames = lastValidation
    ? lastValidation.results
        .filter(r => r.status === 'failed')
        .map(r => r.name as import('../../types/index.js').ValidatorName)
    : undefined;

  // Also re-run validators that depend on the failed ones
  const isRerun = failedValidatorNames && failedValidatorNames.length > 0;

  const fullResult = await runFullValidation({
    runId: state.runId,
    projectPath: state.projectPath,
    profile,
    config: state.config,
    taskConstraints: plan.acceptanceCriteria,
    onOutput: (line) => process.stdout.write(`  [validator] ${line}\n`),
    // On rerun, only validate what failed + its dependents
    onlyValidators: isRerun ? failedValidatorNames : undefined,
  });

  await appendValidationResult(state.runId, fullResult.deterministic);

  if (!fullResult.deterministic.passed) {
    const failedValidators = fullResult.deterministic.results.filter(r => r.status === 'failed');
    const newIssues: Issue[] = [];

    for (const failed of failedValidators) {
      const existingIssue = state.issues.find(
        i => i.status === 'open' && i.category === mapValidatorToCategory(failed.name) && i.stage === 'VALIDATE_DETERMINISTIC',
      );

      if (existingIssue) {
        existingIssue.observed = `${failed.name}: ${failed.error ?? failed.output ?? 'Failed'}`;
        existingIssue.attempts = (state.retryCounts[`issue:${existingIssue.id}`] ?? 0);
        newIssues.push(existingIssue);
      } else {
        const issue: Issue = {
          id: `${failed.name}-${uuidv4().split('-')[0]}`,
          category: mapValidatorToCategory(failed.name),
          severity: 'high',
          stage: 'VALIDATE_DETERMINISTIC',
          observed: `${failed.name}: ${failed.error ?? failed.output ?? 'Failed'}`,
          expected: `${failed.name} should pass`,
          repairHint: failed.output ?? failed.error ?? '',
          status: 'open',
          attempts: 0,
          createdAt: new Date().toISOString(),
        };
        await addIssue(state.runId, issue);
        newIssues.push(issue);
      }
    }

    // Resolve issues for validators that now pass
    const passedNames = new Set<string>(
      fullResult.deterministic.results.filter(r => r.status === 'passed').map(r => r.name),
    );
    for (const issue of state.issues) {
      if (issue.status === 'open' && issue.stage === 'VALIDATE_DETERMINISTIC') {
        const validatorName = issue.id.split('-')[0];
        if (passedNames.has(validatorName)) {
          await resolveIssue(state.runId, issue.id);
          issue.status = 'resolved';
          issue.resolvedAt = new Date().toISOString();
          console.log(`[maiker] ✓ Resolved issue ${issue.id} (${validatorName} now passes)`);
        }
      }
    }

    emitStageCompleted(state.runId, 'VALIDATE_DETERMINISTIC');
    return {
      stage: 'REPAIR' as WorkflowStage,
      issues: [...state.issues.filter(i => !newIssues.find(n => n.id === i.id)), ...newIssues],
      validationResults: [fullResult.deterministic],
      previousFailureCount: failedValidators.length,
      status: 'running' as RunStatus,
    };
  }

  // All passed — resolve open deterministic issues
  for (const issue of state.issues) {
    if (issue.status === 'open' && issue.stage === 'VALIDATE_DETERMINISTIC') {
      await resolveIssue(state.runId, issue.id);
      issue.status = 'resolved';
      issue.resolvedAt = new Date().toISOString();
      console.log(`[maiker] ✓ Resolved issue ${issue.id}`);
    }
  }

  emitStageCompleted(state.runId, 'VALIDATE_DETERMINISTIC');
  return {
    stage: 'VALIDATE_VISUAL' as WorkflowStage,
    validationResults: [fullResult.deterministic],
    issues: state.issues,
    status: 'running' as RunStatus,
  };
}

async function nodeValidateVisual(state: GraphState): Promise<Partial<GraphState>> {
  emitStageStarted(state.runId, 'VALIDATE_VISUAL');
  await setStage(state.runId, 'VALIDATE_VISUAL');
  await setAgent(state.runId, 'visual-reviewer', 'Running Playwright and screenshot capture');

  const plan = state.plan!;
  const profile = plan.validationProfile;
  const needsVisual = profile.required.some(v =>
    ['playwright_e2e', 'screenshot_capture', 'visual_review'].includes(v),
  );

  if (!needsVisual) {
    emitStageCompleted(state.runId, 'VALIDATE_VISUAL');
    return { stage: 'POST_APPROVAL_REVIEW' as WorkflowStage, status: 'running' as RunStatus };
  }

  try {
    const { runVisualValidation } = await import('../../validators/visual/index.js');
    const visualResult = await runVisualValidation({
      runId: state.runId,
      projectPath: state.projectPath,
      config: state.config,
      taskConstraints: plan.acceptanceCriteria,
      onOutput: (line) => process.stdout.write(`  [visual] ${line}\n`),
    });

    const openHighSeverity = visualResult.issues.filter(
      i => i.severity === 'high' || i.severity === 'critical',
    );

    for (const issue of visualResult.issues) {
      await addIssue(state.runId, issue);
    }

    // Resolve previously open visual issues not in new results
    const newIssueIds = new Set(visualResult.issues.map(i => i.id));
    for (const issue of state.issues) {
      if (issue.status === 'open' && issue.stage === 'VALIDATE_VISUAL' && !newIssueIds.has(issue.id)) {
        await resolveIssue(state.runId, issue.id);
        issue.status = 'resolved';
        issue.resolvedAt = new Date().toISOString();
        console.log(`[maiker] ✓ Resolved visual issue ${issue.id}`);
      }
    }

    const allIssues = [...state.issues, ...visualResult.issues];

    if (openHighSeverity.length > 0) {
      emitStageCompleted(state.runId, 'VALIDATE_VISUAL');
      return { stage: 'REPAIR' as WorkflowStage, issues: allIssues, status: 'running' as RunStatus };
    }

    emitStageCompleted(state.runId, 'VALIDATE_VISUAL');
    return { stage: 'POST_APPROVAL_REVIEW' as WorkflowStage, issues: allIssues, status: 'running' as RunStatus };
  } catch (err) {
    console.warn(`[maiker] Visual validation error: ${String(err)}`);
    const warningIssue: Issue = {
      id: `visual-error-${uuidv4().split('-')[0]}`,
      category: 'other',
      severity: 'medium',
      stage: 'VALIDATE_VISUAL',
      observed: `Visual validation crashed: ${String(err)}`,
      expected: 'Visual validation should complete without errors',
      status: 'open',
      attempts: 0,
      createdAt: new Date().toISOString(),
    };
    await addIssue(state.runId, warningIssue);
    emitStageCompleted(state.runId, 'VALIDATE_VISUAL');
    return {
      stage: 'POST_APPROVAL_REVIEW' as WorkflowStage,
      issues: [...state.issues, warningIssue],
      status: 'running' as RunStatus,
    };
  }
}

async function nodeRepair(state: GraphState): Promise<Partial<GraphState>> {
  emitStageStarted(state.runId, 'REPAIR');
  await setStage(state.runId, 'REPAIR');

  const openIssues = await getOpenIssues(state.runId);
  if (openIssues.length === 0) {
    emitStageCompleted(state.runId, 'REPAIR');
    return { stage: 'VALIDATE_DETERMINISTIC' as WorkflowStage, status: 'running' as RunStatus };
  }

  // Increment counters FIRST — before escalation check and before repair agent call,
  // so counts accumulate even when the repair agent throws (e.g. auth 401)
  const runRetry = await incrementRetry(state.runId, 'run');
  const issueAttempts: Record<string, number> = {};
  for (const issue of openIssues) {
    const count = await incrementRetry(state.runId, `issue:${issue.id}`);
    issueAttempts[issue.id] = count;
    issue.attempts = count;
  }

  // Build updated retry counts for graph state
  const updatedRetryCounts: Record<string, number> = { ...state.retryCounts, run: runRetry };
  for (const issue of openIssues) {
    updatedRetryCounts[`issue:${issue.id}`] = issueAttempts[issue.id];
  }

  // Check escalation (now with up-to-date counts)
  for (const issue of openIssues) {
    if (shouldEscalate(issue.id, updatedRetryCounts, state.config.policies)) {
      if (shouldAutoReplan(updatedRetryCounts, state.config.policies)) {
        console.log('[maiker] Auto-replan triggered — repair budget partially exhausted');
        emitStageCompleted(state.runId, 'REPAIR');
        return { stage: 'PLAN' as WorkflowStage, status: 'running' as RunStatus, retryCounts: updatedRetryCounts };
      }
      emitStageCompleted(state.runId, 'REPAIR');
      return { stage: 'HUMAN_ESCALATION' as WorkflowStage, status: 'running' as RunStatus, retryCounts: updatedRetryCounts };
    }
  }

  // Progress tracking
  if (state.previousFailureCount !== undefined) {
    if (openIssues.length > state.previousFailureCount) {
      console.warn(`[maiker] ⚠ Regression: ${openIssues.length} open issues (was ${state.previousFailureCount})`);
    } else if (openIssues.length < state.previousFailureCount) {
      console.log(`[maiker] ↓ Progress: ${state.previousFailureCount} → ${openIssues.length} open issues`);
    }
  }

  emitRepairStarted(state.runId, runRetry);
  await setAgent(state.runId, 'repair', `Applying repair (attempt ${runRetry})`);

  // Determine strategy for structured history
  const strategyConfig = getRepairStrategy(runRetry);

  try {
    emitAgentInvoked(state.runId, 'repair', state.config.models.repairAgent.model);

    const validatorEvidence = state.validationResults
      .flatMap(r => r.results.filter(v => v.status === 'failed'))
      .map(v => `${v.name}: ${v.error ?? v.output ?? ''}`)
      .join('\n\n');

    const repairOutput = await runRepairAgent({
      runId: state.runId,
      goal: state.goal,
      projectPath: state.projectPath,
      issues: openIssues,
      validatorEvidence,
      touchedFiles: state.sharedContext?.changedFiles ?? state.plan?.fileTargetHints ?? [],
      priorAttempts: runRetry,
      issueAttempts,
      priorRepairNotes: state.repairHistory,
      context: state.contextUpdates.map(c => c.message).join('\n'),
    }, state.config);

    emitAgentCompleted(state.runId, 'repair');
    emitRepairCompleted(state.runId);
    console.log(`[maiker] Repair plan: ${repairOutput.patchPlan}`);

    emitStageCompleted(state.runId, 'REPAIR');

    return {
      stage: 'VALIDATE_DETERMINISTIC' as WorkflowStage,
      retryCounts: updatedRetryCounts,
      repairHistory: [`[attempt ${runRetry}] strategy=${strategyConfig.strategy} | plan=${repairOutput.patchPlan} | changed=${repairOutput.changedFiles.join(', ')} | outcome=pending_validation`],
      status: 'running' as RunStatus,
    };
  } catch (err) {
    const classified = classifyError(err);
    console.warn(`[maiker] Repair agent failed [${classified.category}]: ${classified.message}`);
    emitStageCompleted(state.runId, 'REPAIR');

    // Auth errors should escalate immediately, not retry
    if (classified.category === 'auth') {
      return {
        stage: 'HUMAN_ESCALATION' as WorkflowStage,
        retryCounts: updatedRetryCounts,
        repairHistory: [`[attempt ${runRetry}] strategy=${strategyConfig.strategy} | AUTH FAILURE: ${classified.message} | outcome=escalated`],
        status: 'running' as RunStatus,
      };
    }

    return {
      stage: 'VALIDATE_DETERMINISTIC' as WorkflowStage,
      retryCounts: updatedRetryCounts,
      repairHistory: [`[attempt ${runRetry}] strategy=${strategyConfig.strategy} | error=${classified.category}: ${classified.message} | outcome=agent_failed`],
      status: 'running' as RunStatus,
    };
  }
}

/**
 * Human escalation node — uses LangGraph interrupt() for human-in-the-loop.
 * The graph pauses here and can be resumed with a human decision.
 */
async function nodeHumanEscalation(state: GraphState): Promise<Partial<GraphState>> {
  emitStageStarted(state.runId, 'HUMAN_ESCALATION');
  await setStage(state.runId, 'HUMAN_ESCALATION');
  await setStatus(state.runId, 'blocked');

  const openIssues = await getOpenIssues(state.runId);
  emitEscalationTriggered(
    state.runId,
    `${openIssues.length} issues could not be auto-repaired`,
  );

  const packetPath = await writeEscalationPacket(state.runId, {
    summary: `Run ${state.runId} requires human review`,
    failingIssues: openIssues.map(i => `- ${i.id}: ${i.observed} (${i.attempts} attempts)`).join('\n'),
    attemptsCount: state.retryCounts['run'] ?? 0,
    triedSolutions: state.repairHistory,
    likelyRootCause: 'Repeated validation failures suggest structural issue beyond automated repair scope',
    recommendedDecision: 'Review the escalation packet, decide to replan or manually fix, then resume with `maiker resume`',
  });

  console.log(`\n  [maiker] Human review required. Packet written to:\n  ${packetPath}\n`);
  console.log(`  Run: maiker resume --run-id ${state.runId}\n`);

  // LangGraph interrupt — pauses the graph and waits for human input
  const decision = interrupt({
    reason: 'Human escalation required',
    openIssues: openIssues.length,
    packetPath,
    runId: state.runId,
  }) as string | undefined;

  // When resumed, decision comes from the interrupt response
  const humanDecision = (decision ?? 'proceed') as 'proceed' | 'replan' | 'abort';

  if (humanDecision === 'abort') {
    return { stage: 'FAILED' as WorkflowStage, status: 'failed' as RunStatus, error: 'Aborted by human' };
  }
  if (humanDecision === 'replan') {
    return { stage: 'PLAN' as WorkflowStage, status: 'running' as RunStatus, humanDecision };
  }
  return { stage: 'EXECUTE' as WorkflowStage, status: 'running' as RunStatus, humanDecision };
}

async function nodePostApprovalReview(state: GraphState): Promise<Partial<GraphState>> {
  emitStageStarted(state.runId, 'POST_APPROVAL_REVIEW');
  await setStage(state.runId, 'POST_APPROVAL_REVIEW');

  // Enforce human approval policy — pause and wait for explicit go-ahead
  if (state.config.policies.requireHumanApproval) {
    await setStatus(state.runId, 'blocked');
    console.log('\n  [maiker] Human approval required before promotion.');
    console.log(`  Run: maiker resume --run-id ${state.runId} --decision proceed\n`);

    const decision = interrupt({
      reason: 'Human approval required before promotion',
      runId: state.runId,
    }) as string | undefined;

    const humanDecision = (decision ?? 'proceed') as 'proceed' | 'replan' | 'abort';
    await setStatus(state.runId, 'running');

    if (humanDecision === 'abort') {
      emitStageCompleted(state.runId, 'POST_APPROVAL_REVIEW');
      return { stage: 'FAILED' as WorkflowStage, status: 'failed' as RunStatus, error: 'Aborted by human at approval' };
    }
    if (humanDecision === 'replan') {
      emitStageCompleted(state.runId, 'POST_APPROVAL_REVIEW');
      return { stage: 'PLAN' as WorkflowStage, status: 'running' as RunStatus, humanDecision };
    }
  }

  if (!state.config.policies.postApprovalReviewRequired) {
    emitStageCompleted(state.runId, 'POST_APPROVAL_REVIEW');
    return { stage: 'PROMOTE' as WorkflowStage, status: 'running' as RunStatus };
  }

  try {
    emitAgentInvoked(state.runId, 'post-approval-reviewer', state.config.models.postApprovalReview.model);
    await setAgent(state.runId, 'post-approval-reviewer', 'Scanning for hidden regressions');

    const diff = await getFullDiff(state.projectPath).catch(() => 'No diff available');
    const touchedFiles = state.sharedContext?.changedFiles ?? state.plan?.fileTargetHints ?? [];

    // Wrap review in a timeout to prevent the stage from hanging indefinitely
    const REVIEW_TIMEOUT = 120_000; // 2 minutes — review should be fast
    const reviewPromise = runPostApprovalReviewAgent({
      runId: state.runId,
      goal: state.goal,
      projectPath: state.projectPath,
      diffSummary: diff,
      validationHistory: state.validationResults,
      testsModified: [],
      touchedFiles,
    }, state.config);

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Post-approval review timed out after 120s')), REVIEW_TIMEOUT),
    );

    const reviewOutput = await Promise.race([reviewPromise, timeoutPromise]);

    emitAgentCompleted(state.runId, 'post-approval-reviewer');

    if (reviewOutput.overallRisk === 'critical') {
      return { stage: 'HUMAN_ESCALATION' as WorkflowStage, status: 'running' as RunStatus };
    }
  } catch (err) {
    // Log but don't block promotion — review is advisory, not gate-keeping
    console.warn(`[maiker] Post-approval review failed (non-blocking): ${String(err)}`);
    emitAgentCompleted(state.runId, 'post-approval-reviewer');
  }

  emitStageCompleted(state.runId, 'POST_APPROVAL_REVIEW');
  return { stage: 'PROMOTE' as WorkflowStage, status: 'running' as RunStatus };
}

async function nodePromote(state: GraphState): Promise<Partial<GraphState>> {
  emitStageStarted(state.runId, 'PROMOTE');
  await setStage(state.runId, 'PROMOTE');
  await setAgent(state.runId, 'packager', 'Writing final report');

  const openIssues = await getOpenIssues(state.runId);
  const passedValidators = state.validationResults
    .flatMap(r => r.results)
    .filter(r => r.status === 'passed').length;

  const subtaskSummary = Object.values(state.subtaskStates);
  const completedSubtasks = subtaskSummary.filter(s => s.status === 'completed').length;
  const failedSubtasks = subtaskSummary.filter(s => s.status === 'failed').length;

  const summary = [
    `# mAIker Run Summary`,
    ``,
    `**Run ID:** ${state.runId}`,
    `**Goal:** ${state.goal}`,
    `**Status:** DONE`,
    ``,
    `## Execution`,
    `- Total subtasks: ${subtaskSummary.length}`,
    `- Completed: ${completedSubtasks}`,
    `- Failed: ${failedSubtasks}`,
    `- Repair attempts: ${state.retryCounts['run'] ?? 0}`,
    ``,
    `## Validation`,
    `- Validators passed: ${passedValidators}`,
    `- Open issues remaining: ${openIssues.length}`,
    ``,
    `## Acceptance Criteria`,
    ...(state.plan?.acceptanceCriteria.map(c => `- ${c}`) ?? ['None defined']),
    ``,
    `## Changed Files`,
    ...(state.sharedContext?.changedFiles.map(f => `- ${f}`) ?? ['None recorded']),
  ].join('\n');

  await saveFinalSummary(state.runId, summary, { passedValidators, openIssues: openIssues.length }, { status: 'done', runId: state.runId });

  try {
    if (await isGitRepo(state.projectPath)) {
      await removeCheckpoint(state.projectPath, state.runId);
    }
  } catch { /* checkpoint may not exist */ }

  emitStageCompleted(state.runId, 'PROMOTE');
  return { stage: 'DONE' as WorkflowStage, status: 'done' as RunStatus };
}

// ─── LangGraph — Build & Compile ─────────────────────────────────────────────

/**
 * Route after each node based on the `stage` field in state.
 * This is the conditional edge router that drives the entire workflow.
 */
function routeByStage(state: GraphState): string {
  switch (state.stage) {
    case 'CLASSIFY':              return 'classify';
    case 'PLAN':                  return 'planNode';
    case 'EXECUTE':               return 'execute';
    case 'VALIDATE_DETERMINISTIC':return 'validateDeterministic';
    case 'VALIDATE_VISUAL':       return 'validateVisual';
    case 'REPAIR':                return 'repair';
    case 'HUMAN_ESCALATION':      return 'humanEscalation';
    case 'POST_APPROVAL_REVIEW':  return 'postApprovalReview';
    case 'PROMOTE':               return 'promote';
    case 'DONE':
    case 'FAILED':
    case 'BLOCKED':
    case 'PAUSED':
      return END;
    default:
      return END;
  }
}

function buildWorkflowGraph() {
  const graph = new StateGraph(WorkflowState)

    // ── Add all nodes ──
    .addNode('inspect',              nodeInspect)
    .addNode('classify',             nodeClassify)
    .addNode('planNode',             nodePlan, {
      retryPolicy: { maxAttempts: 3, initialInterval: 1000, backoffFactor: 2, jitter: true },
    })
    .addNode('execute',              nodeExecute, {
      retryPolicy: { maxAttempts: 3, initialInterval: 1000, backoffFactor: 2, jitter: true },
    })
    .addNode('validateDeterministic',nodeValidateDeterministic)
    .addNode('validateVisual',       nodeValidateVisual)
    .addNode('repair',               nodeRepair, {
      retryPolicy: { maxAttempts: 3, initialInterval: 1000, backoffFactor: 2, jitter: true },
    })
    .addNode('humanEscalation',      nodeHumanEscalation)
    .addNode('postApprovalReview',   nodePostApprovalReview, {
      retryPolicy: { maxAttempts: 3, initialInterval: 1000, backoffFactor: 2, jitter: true },
    })
    .addNode('promote',              nodePromote)

    // ── Entry edge ──
    .addEdge(START, 'inspect')

    // ── Conditional edges: each node routes to next based on state.stage ──
    .addConditionalEdges('inspect',              routeByStage)
    .addConditionalEdges('classify',             routeByStage)
    .addConditionalEdges('planNode',             routeByStage)
    .addConditionalEdges('execute',              routeByStage)
    .addConditionalEdges('validateDeterministic',routeByStage)
    .addConditionalEdges('validateVisual',       routeByStage)
    .addConditionalEdges('repair',               routeByStage)
    .addConditionalEdges('humanEscalation',      routeByStage)
    .addConditionalEdges('postApprovalReview',   routeByStage)
    .addConditionalEdges('promote',              routeByStage);

  return graph;
}

// ─── Workflow Runner ──────────────────────────────────────────────────────────

// Durable checkpointer — persists graph state to <projectRoot>/.maiker/checkpoints.db
// Enables pause/resume across process restarts via `maiker resume`
// Keyed by project path to avoid cross-project contamination.
import { mkdirSync } from 'fs';

const _checkpointers = new Map<string, SqliteSaver>();

function getCheckpointer(projectPath: string): SqliteSaver {
  // Resolve to absolute path for consistent map key
  const resolvedPath = require('path').resolve(projectPath);
  if (!_checkpointers.has(resolvedPath)) {
    const maikerDir = join(resolvedPath, '.maiker');
    mkdirSync(maikerDir, { recursive: true });
    const dbPath = join(maikerDir, 'checkpoints.db');
    _checkpointers.set(resolvedPath, SqliteSaver.fromConnString(dbPath));
  }
  return _checkpointers.get(resolvedPath)!;
}

export async function runWorkflow(input: WorkflowInput): Promise<GraphState> {
  const { runId, goal, projectPath, config } = input;

  await initRunFolder(
    runId, goal, projectPath,
    (input.flags?.configPath as string) ?? 'maiker.config.yaml',
    config.artifacts.outputDir,
  );

  await eventBus.attachRunLog(runId, config.artifacts.outputDir);
  emitRunStarted(runId);
  await setStatus(runId, 'running');

  // Compile the graph with durable checkpointing (project-rooted DB)
  const graph = buildWorkflowGraph();
  const app = graph.compile({ checkpointer: getCheckpointer(projectPath) });

  const initialState: Partial<GraphState> = {
    runId,
    projectPath,
    goal,
    config,
    dryRun: !!(input.flags?.dryRun),
    stage: 'INSPECT',
    status: 'running',
    currentSubtaskIndex: 0,
  };

  try {
    // Invoke the LangGraph — it handles all node routing, state merging,
    // and checkpointing automatically
    let currentState = await app.invoke(initialState, {
      configurable: { thread_id: runId },
    }) as GraphState;

    // Handle interrupt/resume cycles within the same process
    // When interrupt() fires (e.g., human approval), LangGraph returns
    // with stage still set to the interrupting stage. We detect this,
    // wait for user input, then resume — all within the same process
    // so the SqliteSaver checkpoint is preserved across process restarts.
    while (currentState.stage === 'POST_APPROVAL_REVIEW' || currentState.stage === 'HUMAN_ESCALATION') {
      // The graph is paused at an interrupt — prompt user inline
      const readline = await import('readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

      const decision = await new Promise<string>((resolve) => {
        console.log('');
        console.log('  Options:');
        console.log('    proceed  — approve and continue to promotion');
        console.log('    replan   — go back to PLAN and try a different approach');
        console.log('    abort    — stop the run');
        console.log('');
        rl.question('  Decision [proceed/replan/abort]: ', (answer: string) => {
          rl.close();
          const trimmed = answer.trim().toLowerCase();
          resolve(['proceed', 'replan', 'abort'].includes(trimmed) ? trimmed : 'proceed');
        });
      });

      // Resume the graph from the interrupt checkpoint
      currentState = await app.invoke(
        new Command({ resume: decision }),
        { configurable: { thread_id: runId } },
      ) as GraphState;
    }

    // Persist final state
    await updateRunState(runId, {
      currentStage: currentState.stage,
      status: currentState.status,
      retryCounts: currentState.retryCounts,
      openIssues: currentState.issues.filter(i => i.status === 'open').map(i => i.id),
      resolvedIssues: currentState.issues.filter(i => i.status === 'resolved').map(i => i.id),
    }, config.artifacts.outputDir);

    if (currentState.stage === 'DONE') {
      emitRunCompleted(runId);
    } else if (currentState.stage === 'FAILED') {
      emitRunFailed(runId, currentState.error ?? 'Unknown error');
    }

    eventBus.detachRunLog(runId);
    return currentState;
  } catch (err) {
    emitRunFailed(runId, String(err));
    await setStatus(runId, 'failed');
    eventBus.detachRunLog(runId);
    throw err;
  }
}

/**
 * Resume a previously interrupted workflow (after human escalation).
 * Uses LangGraph's built-in checkpoint resume with the thread_id.
 */
export async function resumeWorkflow(
  runId: string,
  decision: 'proceed' | 'replan' | 'abort',
  config: MaikerConfig,
  projectPath?: string,
): Promise<GraphState> {
  const graph = buildWorkflowGraph();
  const resolvedProject = projectPath ?? config.project.root ?? process.cwd();
  const app = graph.compile({ checkpointer: getCheckpointer(resolvedProject) });

  await eventBus.attachRunLog(runId, config.artifacts.outputDir);

  // Resume the graph — LangGraph replays from checkpoint and
  // passes the decision as the interrupt resume value
  const finalState = await app.invoke(
    new Command({ resume: decision }),
    {
      configurable: { thread_id: runId },
    },
  ) as GraphState;

  await updateRunState(runId, {
    currentStage: finalState.stage,
    status: finalState.status,
  }, config.artifacts.outputDir);

  if (finalState.stage === 'DONE') emitRunCompleted(runId);
  eventBus.detachRunLog(runId);

  return finalState;
}

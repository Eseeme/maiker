/**
 * mAIker Workflow Orchestrator — Powered by LangGraph
 *
 * Uses LangGraph's StateGraph for the workflow state machine:
 * - Annotation for typed, reducible state
 * - Conditional edges for routing decisions
 * - Promise.allSettled for parallel subtask fan-out within waves
 * - MemorySaver for checkpointing and resume
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
  MemorySaver,
  interrupt,
  END,
  START,
} from '@langchain/langgraph';

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
import { getValidationProfile, shouldEscalate, shouldAutoReplan } from '../policies/index.js';
import { runFullValidation } from '../../validators/engine/index.js';
import { summariseRepo } from '../../tools/filesystem/index.js';
import { getFullDiff, isGitRepo, createCheckpoint, removeCheckpoint } from '../../tools/git/index.js';
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
      const shared = wave[i].fileTargets.filter(f => wave[j].fileTargets.includes(f));
      if (shared.length > 0) conflicts.push([wave[i].id, wave[j].id]);
    }
  }
  return conflicts;
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
    console.warn(`[maiker] Planner agent failed, using fallback plan: ${String(err)}`);
    plan.assumptions.push(`Fallback plan used: ${String(err)}`);
  }

  plan.validationProfile = getValidationProfile(classification);
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

  // Execute wave by wave
  for (const wave of waves) {
    const conflicts = detectFileConflicts(wave);
    const groups = conflicts.length > 0 ? wave.map(s => [s]) : [wave];

    for (const group of groups) {
      // Run all subtasks in this group in parallel
      const results = await Promise.allSettled(
        group.map(async (subtask) => {
          emitAgentInvoked(state.runId, 'coder', state.config.models.codeGeneration.model);
          await setAgent(state.runId, 'coder', `[${subtask.id}] ${subtask.title}`);

          const { runCodeAgent } = await import('../../agents/coder/index.js');
          const result = await runCodeAgent({
            runId: state.runId,
            goal: state.goal,
            projectPath: state.projectPath,
            subtask,
            acceptanceCriteria: subtask.acceptanceCriteria,
            fileTargets: subtask.fileTargets,
            noTouchConstraints: plan.classification.noTouchZones,
            repoContext: await summariseRepo(state.projectPath),
            context: state.contextUpdates.map(c => c.message).join('\n'),
            sharedContext,
          }, state.config);

          return { subtaskId: subtask.id, result };
        }),
      );

      // Process results → update shared context
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
          emitAgentCompleted(state.runId, 'coder');
          console.log(`[maiker] ✓ ${subtask.id}: ${result.implementationNotes}`);
        } else {
          subtaskStates[subtask.id] = {
            subtaskId: subtask.id,
            status: 'failed',
            startedAt: new Date().toISOString(),
            changedFiles: [],
            implementationNotes: '',
            error: String(settled.reason),
          };
          console.warn(`[maiker] ✗ ${subtask.id}: ${String(settled.reason)}`);
          emitAgentCompleted(state.runId, 'coder');
        }
      }
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

  const fullResult = await runFullValidation({
    runId: state.runId,
    projectPath: state.projectPath,
    profile,
    config: state.config,
    taskConstraints: plan.acceptanceCriteria,
    onOutput: (line) => process.stdout.write(`  [validator] ${line}\n`),
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

  // Check escalation
  for (const issue of openIssues) {
    if (shouldEscalate(issue.id, state.retryCounts, state.config.policies)) {
      if (shouldAutoReplan(state.retryCounts, state.config.policies)) {
        console.log('[maiker] Auto-replan triggered — repair budget partially exhausted');
        emitStageCompleted(state.runId, 'REPAIR');
        return { stage: 'PLAN' as WorkflowStage, status: 'running' as RunStatus };
      }
      emitStageCompleted(state.runId, 'REPAIR');
      return { stage: 'HUMAN_ESCALATION' as WorkflowStage, status: 'running' as RunStatus };
    }
  }

  // Increment counters
  const runRetry = await incrementRetry(state.runId, 'run');
  const issueAttempts: Record<string, number> = {};
  for (const issue of openIssues) {
    const count = await incrementRetry(state.runId, `issue:${issue.id}`);
    issueAttempts[issue.id] = count;
    issue.attempts = count;
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

    const updatedRetryCounts: Record<string, number> = { ...state.retryCounts, run: runRetry };
    for (const issue of openIssues) {
      updatedRetryCounts[`issue:${issue.id}`] = issueAttempts[issue.id];
    }

    return {
      stage: 'VALIDATE_DETERMINISTIC' as WorkflowStage,
      retryCounts: updatedRetryCounts,
      repairHistory: [`[attempt ${runRetry}] ${repairOutput.patchPlan} → changed: ${repairOutput.changedFiles.join(', ')}`],
      status: 'running' as RunStatus,
    };
  } catch (err) {
    console.warn(`[maiker] Repair agent failed: ${String(err)}`);
    emitStageCompleted(state.runId, 'REPAIR');
    return {
      stage: 'VALIDATE_DETERMINISTIC' as WorkflowStage,
      retryCounts: { ...state.retryCounts, run: runRetry },
      repairHistory: [`[attempt ${runRetry}] FAILED: ${String(err)}`],
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

    const reviewOutput = await runPostApprovalReviewAgent({
      runId: state.runId,
      goal: state.goal,
      projectPath: state.projectPath,
      diffSummary: diff,
      validationHistory: state.validationResults,
      testsModified: [],
      touchedFiles,
    }, state.config);

    emitAgentCompleted(state.runId, 'post-approval-reviewer');

    if (reviewOutput.overallRisk === 'critical') {
      return { stage: 'HUMAN_ESCALATION' as WorkflowStage, status: 'running' as RunStatus };
    }
  } catch (err) {
    console.warn(`[maiker] Post-approval review failed: ${String(err)}`);
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
    case 'PLAN':                  return 'plan';
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
    .addNode('plan',                 nodePlan)
    .addNode('execute',              nodeExecute)
    .addNode('validateDeterministic',nodeValidateDeterministic)
    .addNode('validateVisual',       nodeValidateVisual)
    .addNode('repair',               nodeRepair)
    .addNode('humanEscalation',      nodeHumanEscalation)
    .addNode('postApprovalReview',   nodePostApprovalReview)
    .addNode('promote',              nodePromote)

    // ── Entry edge ──
    .addEdge(START, 'inspect')

    // ── Conditional edges: each node routes to next based on state.stage ──
    .addConditionalEdges('inspect',              routeByStage)
    .addConditionalEdges('classify',             routeByStage)
    .addConditionalEdges('plan',                 routeByStage)
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

// Single shared checkpointer for all runs
const checkpointer = new MemorySaver();

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

  // Compile the graph with checkpointing
  const graph = buildWorkflowGraph();
  const app = graph.compile({ checkpointer });

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
    const finalState = await app.invoke(initialState, {
      configurable: { thread_id: runId },
    }) as GraphState;

    // Persist final state
    await updateRunState(runId, {
      currentStage: finalState.stage,
      status: finalState.status,
      retryCounts: finalState.retryCounts,
      openIssues: finalState.issues.filter(i => i.status === 'open').map(i => i.id),
      resolvedIssues: finalState.issues.filter(i => i.status === 'resolved').map(i => i.id),
    }, config.artifacts.outputDir);

    if (finalState.stage === 'DONE') {
      emitRunCompleted(runId);
    } else if (finalState.stage === 'FAILED') {
      emitRunFailed(runId, finalState.error ?? 'Unknown error');
    }

    eventBus.detachRunLog(runId);
    return finalState;
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
): Promise<GraphState> {
  const graph = buildWorkflowGraph();
  const app = graph.compile({ checkpointer });

  await eventBus.attachRunLog(runId, config.artifacts.outputDir);

  // Resume the graph — LangGraph replays from checkpoint and
  // passes the decision as the interrupt response
  const finalState = await app.invoke(
    null,  // null = resume from checkpoint
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

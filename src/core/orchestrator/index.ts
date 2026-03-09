/**
 * mAIker Workflow Orchestrator
 *
 * Implements the workflow state machine with PARALLEL subtask execution.
 * Subtasks that share no dependencies run concurrently.
 * Subtasks that depend on each other run in waves.
 *
 * Stage flow:
 *   INIT → INSPECT → CLASSIFY → PLAN → EXECUTE (parallel)
 *   EXECUTE → VALIDATE_DETERMINISTIC → VALIDATE_VISUAL
 *   VALIDATE_VISUAL → PASS ? POST_APPROVAL_REVIEW : REPAIR
 *   REPAIR → VALIDATE_DETERMINISTIC (retry loop)
 *   REPAIR → HUMAN_ESCALATION (when threshold reached)
 *   HUMAN_ESCALATION → BLOCKED (await human decision)
 *   POST_APPROVAL_REVIEW → PROMOTE → DONE
 */

import type {
  WorkflowGraphState,
  WorkflowInput,
  WorkflowStage,
  MaikerConfig,
  Issue,
  Subtask,
  SubtaskState,
  SharedContext,
  ValidatorName,
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

// ─── Parallel Execution Helpers ──────────────────────────────────────────────

/**
 * Given a set of subtasks with dependency graphs, compute execution waves.
 * Each wave contains subtasks that can run in parallel.
 * Wave N+1 only starts after all tasks in wave N are complete.
 */
function computeExecutionWaves(subtasks: Subtask[]): Subtask[][] {
  const byId = new Map(subtasks.map(s => [s.id, s]));
  const completed = new Set<string>();
  const remaining = new Set(subtasks.map(s => s.id));
  const waves: Subtask[][] = [];

  // Safety limit to prevent infinite loops on circular deps
  let maxIterations = subtasks.length + 1;

  while (remaining.size > 0 && maxIterations-- > 0) {
    const wave: Subtask[] = [];
    for (const id of remaining) {
      const task = byId.get(id)!;
      const depsReady = task.dependsOn.every(dep => completed.has(dep));
      if (depsReady) {
        wave.push(task);
      }
    }

    if (wave.length === 0) {
      // Circular dependency detected — force remaining into final wave
      console.warn('[maiker] Circular dependency detected in subtasks, forcing sequential execution');
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

/** Detect file conflicts between subtasks in the same wave */
function detectFileConflicts(wave: Subtask[]): Array<[string, string]> {
  const conflicts: Array<[string, string]> = [];
  for (let i = 0; i < wave.length; i++) {
    for (let j = i + 1; j < wave.length; j++) {
      const shared = wave[i].fileTargets.filter(f => wave[j].fileTargets.includes(f));
      if (shared.length > 0) {
        conflicts.push([wave[i].id, wave[j].id]);
      }
    }
  }
  return conflicts;
}

// ─── Node Implementations ─────────────────────────────────────────────────────

async function nodeInspect(
  state: WorkflowGraphState,
): Promise<Partial<WorkflowGraphState>> {
  emitStageStarted(state.runId, 'INSPECT');
  await setStage(state.runId, 'INSPECT');
  await setAgent(state.runId, 'repo-inspector', 'Scanning repository structure');

  try {
    const inspection = await inspectRepo(state.projectPath);
    await saveInspection(state.runId, inspection);
    emitStageCompleted(state.runId, 'INSPECT');
    return { inspection, stage: 'CLASSIFY', status: 'running' };
  } catch (err) {
    return { stage: 'FAILED', error: `Inspect failed: ${String(err)}`, status: 'failed' };
  }
}

async function nodeClassify(
  state: WorkflowGraphState,
): Promise<Partial<WorkflowGraphState>> {
  emitStageStarted(state.runId, 'CLASSIFY');
  await setStage(state.runId, 'CLASSIFY');
  await setAgent(state.runId, 'classifier', 'Classifying task type and risk');

  try {
    const classification = classifyTask(state.goal);
    await saveClassification(state.runId, classification);
    emitStageCompleted(state.runId, 'CLASSIFY');
    return { classification, stage: 'PLAN', status: 'running' };
  } catch (err) {
    return { stage: 'FAILED', error: `Classify failed: ${String(err)}`, status: 'failed' };
  }
}

async function nodePlan(
  state: WorkflowGraphState,
): Promise<Partial<WorkflowGraphState>> {
  emitStageStarted(state.runId, 'PLAN');
  await setStage(state.runId, 'PLAN');

  const inspection = state.inspection!;
  const classification = state.classification!;

  let plan = buildFallbackPlan(state.goal, classification);

  try {
    emitAgentInvoked(
      state.runId,
      'planner',
      state.config.models.planner.model,
    );
    await setAgent(state.runId, 'planner', 'Generating execution plan');

    const repoSummary = await summariseRepo(state.projectPath);

    // Research phase
    const researchOutput = await runResearchAgent(
      {
        runId: state.runId,
        goal: state.goal,
        projectPath: state.projectPath,
        repoSummary,
        constraints: state.contextUpdates.map((c) => c.message),
      },
      state.config,
    );

    // Plan phase
    const plannerOutput = await runPlannerAgent(
      {
        runId: state.runId,
        goal: state.goal,
        projectPath: state.projectPath,
        brief: researchOutput,
        inspection,
        constraints: state.contextUpdates.map((c) => c.message),
      },
      state.config,
    );

    plan = plannerOutput.plan;

    // Ensure all subtasks have dependsOn (backcompat with older planner outputs)
    for (const subtask of plan.subtasks) {
      if (!subtask.dependsOn) {
        subtask.dependsOn = [];
      }
    }

    emitAgentCompleted(state.runId, 'planner');
  } catch (err) {
    // Fall back to heuristic plan
    console.warn(`[maiker] Planner agent failed, using fallback plan: ${String(err)}`);
    plan.assumptions.push(`Fallback plan used: ${String(err)}`);
  }

  // Apply config-level validation profile
  plan.validationProfile = getValidationProfile(classification);

  await savePlan(state.runId, plan);
  emitStageCompleted(state.runId, 'PLAN');
  return { plan, stage: 'EXECUTE', status: 'running' };
}

async function nodeExecute(
  state: WorkflowGraphState,
): Promise<Partial<WorkflowGraphState>> {
  emitStageStarted(state.runId, 'EXECUTE');
  await setStage(state.runId, 'EXECUTE');

  const plan = state.plan!;
  const subtasks = plan.subtasks;

  // Create git checkpoint for rollback
  let gitCheckpointRef: string | undefined;
  try {
    if (await isGitRepo(state.projectPath)) {
      gitCheckpointRef = await createCheckpoint(state.projectPath, state.runId);
      console.log(`[maiker] Git checkpoint created: ${gitCheckpointRef.slice(0, 8)}`);
    }
  } catch (err) {
    console.warn(`[maiker] Could not create git checkpoint: ${String(err)}`);
  }

  // Compute execution waves from dependency graph
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

  // Initialise all subtask states
  for (const subtask of subtasks) {
    subtaskStates[subtask.id] = {
      subtaskId: subtask.id,
      status: 'pending',
      changedFiles: [],
      implementationNotes: '',
    };
  }

  // Execute wave by wave — within each wave, all subtasks run in parallel
  for (let waveIndex = 0; waveIndex < waves.length; waveIndex++) {
    const wave = waves[waveIndex];

    // Check for file conflicts within this wave
    const conflicts = detectFileConflicts(wave);
    if (conflicts.length > 0) {
      console.warn(`[maiker] File conflicts in wave ${waveIndex + 1}: ${conflicts.map(c => c.join('↔')).join(', ')}`);
      console.warn(`[maiker] Conflicting subtasks will run sequentially within the wave`);
    }

    // If conflicts exist, split wave into sequential groups
    const executionGroups = conflicts.length > 0
      ? wave.map(s => [s])  // Fallback: run each sequentially
      : [wave];             // No conflicts: all in parallel

    for (const group of executionGroups) {
      // Mark all tasks in this group as running
      for (const subtask of group) {
        subtaskStates[subtask.id].status = 'running';
        subtaskStates[subtask.id].startedAt = new Date().toISOString();
      }

      // Execute all subtasks in this group in parallel
      const results = await Promise.allSettled(
        group.map(async (subtask) => {
          emitAgentInvoked(
            state.runId,
            'coder',
            state.config.models.codeGeneration.model,
          );
          await setAgent(
            state.runId,
            'coder',
            `[${subtask.id}] ${subtask.title}`,
          );

          const { runCodeAgent } = await import('../../agents/coder/index.js');
          const result = await runCodeAgent(
            {
              runId: state.runId,
              goal: state.goal,
              projectPath: state.projectPath,
              subtask,
              acceptanceCriteria: subtask.acceptanceCriteria,
              fileTargets: subtask.fileTargets,
              noTouchConstraints: plan.classification.noTouchZones,
              repoContext: await summariseRepo(state.projectPath),
              context: state.contextUpdates.map((c) => c.message).join('\n'),
              sharedContext,
            },
            state.config,
          );

          return { subtaskId: subtask.id, result };
        }),
      );

      // Process results — update shared context with completed work
      for (let i = 0; i < group.length; i++) {
        const subtask = group[i];
        const settled = results[i];

        if (settled.status === 'fulfilled') {
          const { result } = settled.value;
          subtaskStates[subtask.id].status = 'completed';
          subtaskStates[subtask.id].completedAt = new Date().toISOString();
          subtaskStates[subtask.id].changedFiles = result.changedFiles;
          subtaskStates[subtask.id].implementationNotes = result.implementationNotes;

          // Propagate to shared context so next subtasks/waves can see this work
          sharedContext.changedFiles.push(...result.changedFiles);
          sharedContext.completedNotes.push({
            subtaskId: subtask.id,
            title: subtask.title,
            notes: result.implementationNotes,
          });

          emitAgentCompleted(state.runId, 'coder');
          console.log(`[maiker] ✓ ${subtask.id}: ${result.implementationNotes}`);
        } else {
          subtaskStates[subtask.id].status = 'failed';
          subtaskStates[subtask.id].error = String(settled.reason);
          console.warn(`[maiker] ✗ ${subtask.id}: ${String(settled.reason)}`);
          emitAgentCompleted(state.runId, 'coder');
        }
      }
    }
  }

  emitStageCompleted(state.runId, 'EXECUTE');
  return {
    stage: 'VALIDATE_DETERMINISTIC',
    currentSubtaskIndex: plan.subtasks.length,
    subtaskStates,
    sharedContext,
    status: 'running',
  };
}

async function nodeValidateDeterministic(
  state: WorkflowGraphState,
): Promise<Partial<WorkflowGraphState>> {
  emitStageStarted(state.runId, 'VALIDATE_DETERMINISTIC');
  await setStage(state.runId, 'VALIDATE_DETERMINISTIC');
  await setAgent(state.runId, 'validator', 'Running build, lint, typecheck, tests');

  const plan = state.plan!;
  const profile = plan.validationProfile;

  try {
    const fullResult = await runFullValidation({
      runId: state.runId,
      projectPath: state.projectPath,
      profile,
      config: state.config,
      taskConstraints: state.plan?.acceptanceCriteria ?? [],
      onOutput: (line) => process.stdout.write(`  [validator] ${line}\n`),
    });

    await appendValidationResult(state.runId, fullResult.deterministic);
    const newResults = [...state.validationResults, fullResult.deterministic];

    if (!fullResult.deterministic.passed) {
      // BUG FIX: Create per-validator issues instead of one aggregate
      const failedValidators = fullResult.deterministic.results
        .filter((r) => r.status === 'failed');

      const newIssues: Issue[] = [];
      const existingIssueIds = new Set(state.issues.map(i => i.id));

      for (const failed of failedValidators) {
        // Deduplicate: check if we already have an open issue for this validator
        const existingIssue = state.issues.find(
          i => i.status === 'open' && i.category === mapValidatorToCategory(failed.name) && i.stage === 'VALIDATE_DETERMINISTIC',
        );

        if (existingIssue) {
          // Update the existing issue's evidence instead of creating a duplicate
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

      // BUG FIX: Resolve issues for validators that NOW pass but were previously open
      const passedNames = new Set<string>(
        fullResult.deterministic.results.filter(r => r.status === 'passed').map(r => r.name),
      );
      for (const issue of state.issues) {
        if (issue.status === 'open' && issue.stage === 'VALIDATE_DETERMINISTIC') {
          // Check if the validator this issue belongs to now passes
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

      // Track failure count for progress comparison
      const currentFailureCount = failedValidators.length;
      return {
        stage: 'REPAIR',
        issues: [...state.issues.filter(i => !newIssues.find(n => n.id === i.id)), ...newIssues],
        validationResults: newResults,
        previousFailureCount: currentFailureCount,
        status: 'running',
      };
    }

    // All deterministic validators passed — resolve any open deterministic issues
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
      stage: 'VALIDATE_VISUAL',
      validationResults: newResults,
      issues: state.issues,
      status: 'running',
    };
  } catch (err) {
    return {
      stage: 'FAILED',
      error: `Validation failed: ${String(err)}`,
      status: 'failed',
    };
  }
}

/** Map validator name to issue category */
function mapValidatorToCategory(validatorName: ValidatorName | string): Issue['category'] {
  switch (validatorName) {
    case 'build': return 'build';
    case 'lint': return 'lint';
    case 'typecheck': return 'type';
    case 'unit_tests':
    case 'integration_tests':
    case 'regression_tests': return 'test';
    default: return 'other';
  }
}

async function nodeValidateVisual(
  state: WorkflowGraphState,
): Promise<Partial<WorkflowGraphState>> {
  emitStageStarted(state.runId, 'VALIDATE_VISUAL');
  await setStage(state.runId, 'VALIDATE_VISUAL');
  await setAgent(state.runId, 'visual-reviewer', 'Running Playwright and screenshot capture');

  const plan = state.plan!;
  const profile = plan.validationProfile;
  const needsVisual = profile.required.some((v) =>
    ['playwright_e2e', 'screenshot_capture', 'visual_review'].includes(v),
  );

  if (!needsVisual) {
    // Resolve any open visual issues since we're skipping
    emitStageCompleted(state.runId, 'VALIDATE_VISUAL');
    return { stage: 'POST_APPROVAL_REVIEW', status: 'running' };
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
      (i) => i.severity === 'high' || i.severity === 'critical',
    );

    for (const issue of visualResult.issues) {
      await addIssue(state.runId, issue);
    }

    // Resolve previously open visual issues that aren't in the new results
    const newIssueIds = new Set(visualResult.issues.map(i => i.id));
    for (const issue of state.issues) {
      if (issue.status === 'open' && issue.stage === 'VALIDATE_VISUAL' && !newIssueIds.has(issue.id)) {
        await resolveIssue(state.runId, issue.id);
        issue.status = 'resolved';
        issue.resolvedAt = new Date().toISOString();
        console.log(`[maiker] ✓ Resolved visual issue ${issue.id}`);
      }
    }

    const newIssues = [...state.issues, ...visualResult.issues];

    if (openHighSeverity.length > 0) {
      emitStageCompleted(state.runId, 'VALIDATE_VISUAL');
      return {
        stage: 'REPAIR',
        issues: newIssues,
        status: 'running',
      };
    }

    emitStageCompleted(state.runId, 'VALIDATE_VISUAL');
    return { stage: 'POST_APPROVAL_REVIEW', issues: newIssues, status: 'running' };
  } catch (err) {
    // BUG FIX: Visual validation error creates a warning issue instead of silently continuing
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
    // Continue to post-approval (medium severity doesn't block) but issue is tracked
    return { stage: 'POST_APPROVAL_REVIEW', issues: [...state.issues, warningIssue], status: 'running' };
  }
}

async function nodeRepair(
  state: WorkflowGraphState,
): Promise<Partial<WorkflowGraphState>> {
  emitStageStarted(state.runId, 'REPAIR');
  await setStage(state.runId, 'REPAIR');

  const openIssues = await getOpenIssues(state.runId);
  if (openIssues.length === 0) {
    emitStageCompleted(state.runId, 'REPAIR');
    return { stage: 'VALIDATE_DETERMINISTIC', status: 'running' };
  }

  // Check escalation threshold for each open issue
  for (const issue of openIssues) {
    if (shouldEscalate(issue.id, state.retryCounts, state.config.policies)) {
      // Check if we should auto-replan before escalating to human
      if (shouldAutoReplan(state.retryCounts, state.config.policies)) {
        console.log('[maiker] Auto-replan triggered — repair budget partially exhausted without resolution');
        emitStageCompleted(state.runId, 'REPAIR');
        return { stage: 'PLAN', status: 'running' };
      }
      emitStageCompleted(state.runId, 'REPAIR');
      return { stage: 'HUMAN_ESCALATION', status: 'running' };
    }
  }

  // Increment repair counters
  const runRetry = await incrementRetry(state.runId, 'run');
  for (const issue of openIssues) {
    await incrementRetry(state.runId, `issue:${issue.id}`);
    // BUG FIX: Update issue.attempts field
    issue.attempts = (state.retryCounts[`issue:${issue.id}`] ?? 0) + 1;
  }

  // Progress tracking: compare failure count to previous cycle
  if (state.previousFailureCount !== undefined) {
    const currentOpenCount = openIssues.length;
    if (currentOpenCount > state.previousFailureCount) {
      console.warn(`[maiker] ⚠ Regression detected: ${currentOpenCount} open issues (was ${state.previousFailureCount})`);
    } else if (currentOpenCount < state.previousFailureCount) {
      console.log(`[maiker] ↓ Progress: ${state.previousFailureCount} → ${currentOpenCount} open issues`);
    }
  }

  emitRepairStarted(state.runId, runRetry);
  await setAgent(
    state.runId,
    'repair',
    `Applying repair (attempt ${runRetry})`,
  );

  // Build per-issue attempt counts for the repair agent
  const issueAttempts: Record<string, number> = {};
  for (const issue of openIssues) {
    issueAttempts[issue.id] = (state.retryCounts[`issue:${issue.id}`] ?? 0) + 1;
  }

  try {
    emitAgentInvoked(
      state.runId,
      'repair',
      state.config.models.repairAgent.model,
    );

    const validatorEvidence = state.validationResults
      .flatMap((r) => r.results.filter((v) => v.status === 'failed'))
      .map((v) => `${v.name}: ${v.error ?? v.output ?? ''}`)
      .join('\n\n');

    const repairOutput = await runRepairAgent(
      {
        runId: state.runId,
        goal: state.goal,
        projectPath: state.projectPath,
        issues: openIssues,
        validatorEvidence,
        touchedFiles: state.sharedContext?.changedFiles ?? state.plan?.fileTargetHints ?? [],
        priorAttempts: runRetry,
        issueAttempts,
        priorRepairNotes: state.repairHistory,
        context: state.contextUpdates.map((c) => c.message).join('\n'),
      },
      state.config,
    );

    emitAgentCompleted(state.runId, 'repair');
    emitRepairCompleted(state.runId);
    console.log(`[maiker] Repair plan: ${repairOutput.patchPlan}`);

    // Track repair history for next attempt
    const updatedRepairHistory = [
      ...state.repairHistory,
      `[attempt ${runRetry}] ${repairOutput.patchPlan} → changed: ${repairOutput.changedFiles.join(', ')}`,
    ];

    emitStageCompleted(state.runId, 'REPAIR');

    const updatedRetryCounts = { ...state.retryCounts };
    updatedRetryCounts['run'] = runRetry;
    for (const issue of openIssues) {
      updatedRetryCounts[`issue:${issue.id}`] = issueAttempts[issue.id];
    }

    return {
      stage: 'VALIDATE_DETERMINISTIC',
      retryCounts: updatedRetryCounts,
      repairHistory: updatedRepairHistory,
      status: 'running',
    };
  } catch (err) {
    console.warn(`[maiker] Repair agent failed: ${String(err)}`);
    emitStageCompleted(state.runId, 'REPAIR');

    const updatedRetryCounts = { ...state.retryCounts };
    updatedRetryCounts['run'] = runRetry;

    return {
      stage: 'VALIDATE_DETERMINISTIC',
      retryCounts: updatedRetryCounts,
      repairHistory: [...state.repairHistory, `[attempt ${runRetry}] FAILED: ${String(err)}`],
      status: 'running',
    };
  }
}

async function nodeHumanEscalation(
  state: WorkflowGraphState,
): Promise<Partial<WorkflowGraphState>> {
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
    failingIssues: openIssues.map((i) => `- ${i.id}: ${i.observed} (${i.attempts} attempts)`).join('\n'),
    attemptsCount: state.retryCounts['run'] ?? 0,
    triedSolutions: state.repairHistory,
    likelyRootCause: 'Repeated validation failures suggest structural issue beyond automated repair scope',
    recommendedDecision:
      'Review the escalation packet, decide to replan or manually fix, then resume with `maiker resume`',
  });

  console.log(`\n  [maiker] Human review required. Packet written to:\n  ${packetPath}\n`);
  console.log(`  Run: maiker resume --run-id ${state.runId}\n`);

  return { stage: 'BLOCKED', status: 'blocked' };
}

async function nodePostApprovalReview(
  state: WorkflowGraphState,
): Promise<Partial<WorkflowGraphState>> {
  emitStageStarted(state.runId, 'POST_APPROVAL_REVIEW');
  await setStage(state.runId, 'POST_APPROVAL_REVIEW');

  if (!state.config.policies.postApprovalReviewRequired) {
    emitStageCompleted(state.runId, 'POST_APPROVAL_REVIEW');
    return { stage: 'PROMOTE', status: 'running' };
  }

  try {
    emitAgentInvoked(
      state.runId,
      'post-approval-reviewer',
      state.config.models.postApprovalReview.model,
    );
    await setAgent(
      state.runId,
      'post-approval-reviewer',
      'Scanning for hidden regressions and scope drift',
    );

    const diff = await getFullDiff(state.projectPath).catch(() => 'No diff available');
    const touchedFiles = state.sharedContext?.changedFiles ?? state.plan?.fileTargetHints ?? [];

    const reviewOutput = await runPostApprovalReviewAgent(
      {
        runId: state.runId,
        goal: state.goal,
        projectPath: state.projectPath,
        diffSummary: diff,
        validationHistory: state.validationResults,
        testsModified: [],
        touchedFiles,
      },
      state.config,
    );

    emitAgentCompleted(state.runId, 'post-approval-reviewer');

    if (reviewOutput.overallRisk === 'critical') {
      return { stage: 'HUMAN_ESCALATION', status: 'running' };
    }
  } catch (err) {
    console.warn(`[maiker] Post-approval review failed: ${String(err)}`);
  }

  emitStageCompleted(state.runId, 'POST_APPROVAL_REVIEW');
  return { stage: 'PROMOTE', status: 'running' };
}

async function nodePromote(
  state: WorkflowGraphState,
): Promise<Partial<WorkflowGraphState>> {
  emitStageStarted(state.runId, 'PROMOTE');
  await setStage(state.runId, 'PROMOTE');
  await setAgent(state.runId, 'packager', 'Writing final report');

  const openIssues = await getOpenIssues(state.runId);
  const passedValidators = state.validationResults
    .flatMap((r) => r.results)
    .filter((r) => r.status === 'passed').length;

  // Count subtask execution results
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
    ...(state.plan?.acceptanceCriteria.map((c) => `- ${c}`) ?? ['None defined']),
    ``,
    `## Changed Files`,
    ...(state.sharedContext?.changedFiles.map(f => `- ${f}`) ?? ['None recorded']),
  ].join('\n');

  await saveFinalSummary(
    state.runId,
    summary,
    { passedValidators, openIssues: openIssues.length },
    { status: 'done', runId: state.runId },
  );

  // Clean up git checkpoint on success
  try {
    if (await isGitRepo(state.projectPath)) {
      await removeCheckpoint(state.projectPath, state.runId);
    }
  } catch {
    // Checkpoint may not exist, that's fine
  }

  emitStageCompleted(state.runId, 'PROMOTE');
  return { stage: 'DONE', status: 'done' };
}

// ─── Graph Router ─────────────────────────────────────────────────────────────

type NodeFn = (state: WorkflowGraphState) => Promise<Partial<WorkflowGraphState>>;

const NODE_MAP: Record<string, NodeFn> = {
  INSPECT: nodeInspect,
  CLASSIFY: nodeClassify,
  PLAN: nodePlan,
  EXECUTE: nodeExecute,
  VALIDATE_DETERMINISTIC: nodeValidateDeterministic,
  VALIDATE_VISUAL: nodeValidateVisual,
  REPAIR: nodeRepair,
  HUMAN_ESCALATION: nodeHumanEscalation,
  POST_APPROVAL_REVIEW: nodePostApprovalReview,
  PROMOTE: nodePromote,
};

const TERMINAL_STAGES = new Set<WorkflowStage>([
  'DONE',
  'FAILED',
  'BLOCKED',
  'PAUSED',
]);

// ─── Workflow Runner ──────────────────────────────────────────────────────────

export async function runWorkflow(input: WorkflowInput): Promise<WorkflowGraphState> {
  const { runId, goal, projectPath, config } = input;

  await initRunFolder(
    runId,
    goal,
    projectPath,
    input.flags?.configPath as string ?? 'maiker.config.yaml',
    config.artifacts.outputDir,
  );

  await eventBus.attachRunLog(runId, config.artifacts.outputDir);
  emitRunStarted(runId);

  let state: WorkflowGraphState = {
    runId,
    projectPath,
    goal,
    config,
    stage: 'INSPECT',
    status: 'running',
    currentSubtaskIndex: 0,
    validationResults: [],
    issues: [],
    contextUpdates: [],
    retryCounts: {},
    subtaskStates: {},
    sharedContext: { changedFiles: [], completedNotes: [] },
    repairHistory: [],
  };

  await setStatus(runId, 'running');

  try {
    while (!TERMINAL_STAGES.has(state.stage)) {
      const node = NODE_MAP[state.stage];
      if (!node) {
        state = { ...state, stage: 'FAILED', error: `Unknown stage: ${state.stage}`, status: 'failed' };
        break;
      }

      // Check for pause signal
      const currentState = await import('../state/index.js').then(m =>
        m.loadRunState(runId, config.artifacts.outputDir),
      );
      if (currentState.status === 'paused') {
        state = { ...state, stage: 'PAUSED', status: 'paused' };
        break;
      }

      const patch = await node(state);
      state = { ...state, ...patch };

      await updateRunState(runId, {
        currentStage: state.stage,
        status: state.status,
        retryCounts: state.retryCounts,
        openIssues: state.issues.filter(i => i.status === 'open').map(i => i.id),
        resolvedIssues: state.issues.filter(i => i.status === 'resolved').map(i => i.id),
      }, config.artifacts.outputDir);
    }

    if (state.stage === 'DONE') {
      emitRunCompleted(runId);
    } else if (state.stage === 'FAILED') {
      emitRunFailed(runId, state.error ?? 'Unknown error');
    }
  } catch (err) {
    state = { ...state, stage: 'FAILED', error: String(err), status: 'failed' };
    emitRunFailed(runId, String(err));
    await setStatus(runId, 'failed');
  }

  eventBus.detachRunLog(runId);
  return state;
}

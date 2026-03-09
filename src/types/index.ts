// ─── mAIker — Shared Type Definitions ────────────────────────────────────────

// ─── Workflow Stages ──────────────────────────────────────────────────────────

export type WorkflowStage =
  | 'INIT'
  | 'INSPECT'
  | 'CLASSIFY'
  | 'PLAN'
  | 'EXECUTE'
  | 'VALIDATE_DETERMINISTIC'
  | 'VALIDATE_VISUAL'
  | 'REPAIR'
  | 'HUMAN_ESCALATION'
  | 'POST_APPROVAL_REVIEW'
  | 'PROMOTE'
  | 'DONE'
  | 'FAILED'
  | 'BLOCKED'
  | 'PAUSED';

export type RunStatus = 'pending' | 'running' | 'paused' | 'done' | 'failed' | 'blocked';

// ─── Task Classification ──────────────────────────────────────────────────────

export type TaskType =
  | 'mobile-responsive-redesign'
  | 'framework-upgrade'
  | 'feature-work'
  | 'bugfix'
  | 'refactor'
  | 'unknown';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface TaskClassification {
  taskType: TaskType;
  riskLevel: RiskLevel;
  affectedAreas: string[];
  noTouchZones: string[];
  estimatedComplexity: 'simple' | 'moderate' | 'complex';
}

// ─── Repository Inspection ────────────────────────────────────────────────────

export type Framework =
  | 'nextjs'
  | 'react'
  | 'vue'
  | 'nuxt'
  | 'angular'
  | 'svelte'
  | 'remix'
  | 'express'
  | 'fastify'
  | 'unknown';

export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun' | 'unknown';
export type TestFramework = 'jest' | 'vitest' | 'mocha' | 'playwright' | 'cypress' | 'none';

export interface RepoInspection {
  framework: Framework;
  packageManager: PackageManager;
  testFramework: TestFramework;
  routes: string[];
  entryPoints: string[];
  hotspots: string[];
  dependencies: Record<string, string>;
  scripts: Record<string, string>;
  hasTypeScript: boolean;
  hasLinting: boolean;
  hasPlaywright: boolean;
}

// ─── Planning ─────────────────────────────────────────────────────────────────

export interface Subtask {
  id: string;
  title: string;
  description: string;
  fileTargets: string[];
  acceptanceCriteria: string[];
  order: number;
  dependsOn: string[];       // IDs of subtasks that must complete first
}

// ─── Parallel Execution State ────────────────────────────────────────────────

export type SubtaskStatus = 'pending' | 'ready' | 'running' | 'completed' | 'failed' | 'skipped';

export interface SubtaskState {
  subtaskId: string;
  status: SubtaskStatus;
  startedAt?: string;
  completedAt?: string;
  changedFiles: string[];
  implementationNotes: string;
  error?: string;
}

/** Accumulated context shared across parallel subtask executions */
export interface SharedContext {
  /** Files changed by completed subtasks — next subtasks know what exists */
  changedFiles: string[];
  /** Implementation notes from completed subtasks — agents can reference prior work */
  completedNotes: Array<{ subtaskId: string; title: string; notes: string }>;
  /** Git checkpoint ref for rollback if execution goes wrong */
  gitCheckpointRef?: string;
}

export interface ExecutionPlan {
  classification: TaskClassification;
  subtasks: Subtask[];
  acceptanceCriteria: string[];
  validationProfile: ValidationProfile;
  fileTargetHints: string[];
  riskList: string[];
  assumptions: string[];
}

// ─── Validation ───────────────────────────────────────────────────────────────

export type ValidatorName =
  | 'install'
  | 'build'
  | 'lint'
  | 'typecheck'
  | 'unit_tests'
  | 'integration_tests'
  | 'playwright_e2e'
  | 'screenshot_capture'
  | 'visual_review'
  | 'ux_rules'
  | 'accessibility'
  | 'lockfile_sanity'
  | 'regression_tests'
  | 'mobile_layout_rules';

export interface ValidationProfile {
  taskType: TaskType;
  required: ValidatorName[];
  optional: ValidatorName[];
  skipped: ValidatorName[];
}

export type ValidatorStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

export interface ValidatorResult {
  name: ValidatorName;
  status: ValidatorStatus;
  duration?: number;
  output?: string;
  error?: string;
  artifacts?: string[];
}

export interface ValidationResult {
  stage: 'deterministic' | 'visual';
  results: ValidatorResult[];
  passed: boolean;
  failedCount: number;
  startedAt: string;
  completedAt: string;
}

// ─── Issues ───────────────────────────────────────────────────────────────────

export type IssueSeverity = 'low' | 'medium' | 'high' | 'critical';
export type IssueCategory = 'layout' | 'behavior' | 'performance' | 'accessibility' | 'build' | 'test' | 'type' | 'lint' | 'other';
export type IssueStatus = 'open' | 'resolved' | 'escalated' | 'wont_fix';

export interface Issue {
  id: string;
  category: IssueCategory;
  severity: IssueSeverity;
  stage: WorkflowStage;
  page?: string;
  viewport?: string;
  selector?: string;
  observed: string;
  expected: string;
  repairHint?: string;
  status: IssueStatus;
  attempts: number;
  createdAt: string;
  resolvedAt?: string;
  evidenceRefs?: string[];
}

// ─── Context ──────────────────────────────────────────────────────────────────

export type ContextImpact = 'low' | 'medium' | 'high';

export interface ContextUpdate {
  id: string;
  message: string;
  impact: ContextImpact;
  action: 'continue' | 'rerun_current_stage' | 'replan_downstream';
  addedAt: string;
}

// ─── Run State ────────────────────────────────────────────────────────────────

export interface RunState {
  runId: string;
  projectPath: string;
  goal: string;
  status: RunStatus;
  currentStage: WorkflowStage;
  currentAgent?: string;
  currentAction?: string;
  retryCounts: Record<string, number>;
  openIssues: string[];
  resolvedIssues: string[];
  contextUpdates: ContextUpdate[];
  inspection?: RepoInspection;
  classification?: TaskClassification;
  plan?: ExecutionPlan;
  validationResults?: ValidationResult[];
  createdAt: string;
  lastUpdatedAt: string;
  completedAt?: string;
}

export interface JobSpec {
  runId: string;
  goal: string;
  projectPath: string;
  configPath: string;
  flags: Record<string, unknown>;
  createdAt: string;
}

// ─── Events ───────────────────────────────────────────────────────────────────

export type MaikerEventType =
  | 'run_started'
  | 'run_completed'
  | 'run_failed'
  | 'run_paused'
  | 'run_resumed'
  | 'stage_started'
  | 'stage_completed'
  | 'agent_invoked'
  | 'agent_completed'
  | 'tool_started'
  | 'tool_completed'
  | 'validator_started'
  | 'validator_passed'
  | 'validator_failed'
  | 'issue_created'
  | 'issue_resolved'
  | 'repair_started'
  | 'repair_completed'
  | 'escalation_triggered'
  | 'context_added'
  | 'context_analyzed'
  | 'approval_requested'
  | 'approval_received'
  | 'artifact_saved';

export interface MaikerEvent {
  type: MaikerEventType;
  runId: string;
  timestamp: string;
  stage?: WorkflowStage;
  agent?: string;
  tool?: string;
  issueId?: string;
  severity?: IssueSeverity;
  message?: string;
  data?: Record<string, unknown>;
}

// ─── Agents ───────────────────────────────────────────────────────────────────

export interface AgentInput {
  runId: string;
  goal: string;
  projectPath: string;
  context?: string;
}

export interface ResearchAgentInput extends AgentInput {
  repoSummary: string;
  constraints?: string[];
  references?: string[];
}

export interface ResearchAgentOutput {
  objective: string;
  functionalRequirements: string[];
  nonFunctionalRequirements: string[];
  uxConstraints: string[];
  forbiddenPatterns: string[];
  assumptions: string[];
  openQuestions: string[];
  evidenceRefs: string[];
}

export interface PlannerAgentInput extends AgentInput {
  brief: ResearchAgentOutput;
  inspection: RepoInspection;
  constraints?: string[];
}

export interface PlannerAgentOutput {
  classification: TaskClassification;
  plan: ExecutionPlan;
}

export interface CodeAgentInput extends AgentInput {
  subtask: Subtask;
  acceptanceCriteria: string[];
  fileTargets: string[];
  noTouchConstraints: string[];
  repoContext: string;
  /** Context from previously completed subtasks (parallel execution) */
  sharedContext?: SharedContext;
}

export interface CodeAgentOutput {
  changedFiles: string[];
  implementationNotes: string;
  riskNotes: string;
}

export interface RepairAgentInput extends AgentInput {
  issues: Issue[];
  validatorEvidence: string;
  touchedFiles: string[];
  priorAttempts: number;
  /** Per-issue attempt counts so agent can adjust strategy on later tries */
  issueAttempts: Record<string, number>;
  /** Previous repair results so agent can see what was already tried */
  priorRepairNotes: string[];
}

export interface RepairAgentOutput {
  patchPlan: string;
  changedFiles: string[];
  expectedImpact: string;
  residualRisk: string;
}

export interface VisualReviewAgentInput extends AgentInput {
  screenshotPaths: string[];
  viewports: string[];
  taskConstraints: string[];
  routeMetadata: Record<string, string>;
}

export interface VisualReviewAgentOutput {
  issues: Issue[];
  evidenceRefs: string[];
  summary: string;
}

export interface PostApprovalReviewAgentInput extends AgentInput {
  diffSummary: string;
  validationHistory: ValidationResult[];
  testsModified: string[];
  touchedFiles: string[];
}

export interface PostApprovalReviewAgentOutput {
  regressionFindings: string[];
  scopeDriftFindings: string[];
  suspiciousChurnFindings: string[];
  overallRisk: RiskLevel;
  summary: string;
}

// ─── Config ───────────────────────────────────────────────────────────────────

// Provider can be any string — 'claude' | 'openai' | 'gemini' | 'pi-mono' are
// the built-in adapters, but you can add your own in src/providers/ and use
// any identifier here. Every role is independently configurable.
export interface ModelConfig {
  provider: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface PlaywrightConfig {
  baseUrl: string;
  viewports: [number, number][];
  routes: string[];
  timeout?: number;
}

export interface PolicyConfig {
  requireHumanApproval: boolean;
  postApprovalReviewRequired: boolean;
  maxAutoRepairsPerIssue: number;
  maxAutoRepairsPerRun: number;
  maxVisualRetries: number;
  stopOnBuildFailure: boolean;
}

export interface ArtifactsConfig {
  outputDir: string;
  saveScreenshots: boolean;
  savePlaywrightTrace: boolean;
  saveDiffReports: boolean;
}

export interface MaikerConfig {
  project: {
    name: string;
    root: string;
    framework: string;
    packageManager: string;
  };
  models: {
    researchIngestion: ModelConfig;
    planner: ModelConfig;
    codeGeneration: ModelConfig;
    repairAgent: ModelConfig;
    visualReview: ModelConfig;
    postApprovalReview: ModelConfig;
  };
  validators: Record<ValidatorName, boolean>;
  playwright: PlaywrightConfig;
  policies: PolicyConfig;
  artifacts: ArtifactsConfig;
}

// ─── Workflow ─────────────────────────────────────────────────────────────────

export interface WorkflowInput {
  runId: string;
  goal: string;
  projectPath: string;
  config: MaikerConfig;
  flags?: Record<string, unknown>;
}

export interface WorkflowGraphState {
  runId: string;
  projectPath: string;
  goal: string;
  config: MaikerConfig;
  stage: WorkflowStage;
  status: RunStatus;
  inspection?: RepoInspection;
  classification?: TaskClassification;
  plan?: ExecutionPlan;
  currentSubtaskIndex: number;
  validationResults: ValidationResult[];
  issues: Issue[];
  contextUpdates: ContextUpdate[];
  retryCounts: Record<string, number>;
  error?: string;
  humanDecision?: 'proceed' | 'replan' | 'abort';
  /** Per-subtask execution state for parallel tracking */
  subtaskStates: Record<string, SubtaskState>;
  /** Shared context accumulated from completed subtasks */
  sharedContext: SharedContext;
  /** Notes from previous repair attempts (fed back to repair agent) */
  repairHistory: string[];
  /** Previous validation failure count — used to detect repair progress/regression */
  previousFailureCount?: number;
}

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
import type { WorkflowInput, WorkflowStage, MaikerConfig, Issue, SubtaskState, SharedContext, ValidationResult, ContextUpdate, RepoInspection, TaskClassification, ExecutionPlan, RunStatus } from '../../types/index.js';
/**
 * The LangGraph state annotation.
 * Each field can have a reducer so that parallel nodes can write
 * to the same key without overwriting each other's work.
 */
declare const WorkflowState: import("@langchain/langgraph").AnnotationRoot<{
    runId: import("@langchain/langgraph").LastValue<string>;
    projectPath: import("@langchain/langgraph").LastValue<string>;
    goal: import("@langchain/langgraph").LastValue<string>;
    config: import("@langchain/langgraph").LastValue<MaikerConfig>;
    dryRun: import("@langchain/langgraph").LastValue<boolean>;
    stage: import("@langchain/langgraph").LastValue<WorkflowStage>;
    status: import("@langchain/langgraph").LastValue<RunStatus>;
    error: import("@langchain/langgraph").LastValue<string | undefined>;
    inspection: import("@langchain/langgraph").LastValue<RepoInspection | undefined>;
    classification: import("@langchain/langgraph").LastValue<TaskClassification | undefined>;
    plan: import("@langchain/langgraph").LastValue<ExecutionPlan | undefined>;
    currentSubtaskIndex: import("@langchain/langgraph").LastValue<number>;
    subtaskStates: import("@langchain/langgraph").BinaryOperatorAggregate<Record<string, SubtaskState>, Record<string, SubtaskState>>;
    sharedContext: import("@langchain/langgraph").BinaryOperatorAggregate<SharedContext, SharedContext>;
    validationResults: import("@langchain/langgraph").BinaryOperatorAggregate<ValidationResult[], ValidationResult[]>;
    issues: import("@langchain/langgraph").BinaryOperatorAggregate<Issue[], Issue[]>;
    retryCounts: import("@langchain/langgraph").BinaryOperatorAggregate<Record<string, number>, Record<string, number>>;
    repairHistory: import("@langchain/langgraph").BinaryOperatorAggregate<string[], string[]>;
    previousFailureCount: import("@langchain/langgraph").LastValue<number | undefined>;
    contextUpdates: import("@langchain/langgraph").BinaryOperatorAggregate<ContextUpdate[], ContextUpdate[]>;
    humanDecision: import("@langchain/langgraph").LastValue<"replan" | "proceed" | "abort" | undefined>;
}>;
type GraphState = typeof WorkflowState.State;
export declare function runWorkflow(input: WorkflowInput): Promise<GraphState>;
/**
 * Resume a previously interrupted workflow (after human escalation).
 * Uses LangGraph's built-in checkpoint resume with the thread_id.
 */
export declare function resumeWorkflow(runId: string, decision: 'proceed' | 'replan' | 'abort', config: MaikerConfig): Promise<GraphState>;
export {};
//# sourceMappingURL=index.d.ts.map
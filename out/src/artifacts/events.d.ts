import { EventEmitter } from 'events';
import type { MaikerEvent, WorkflowStage, IssueSeverity } from '../types/index.js';
declare class MaikerEventBus extends EventEmitter {
    private logHandles;
    attachRunLog(runId: string, baseDir?: string): Promise<void>;
    detachRunLog(runId: string): void;
    emit(event: string | symbol, ...args: unknown[]): boolean;
    publish(evt: MaikerEvent): void;
}
export declare const eventBus: MaikerEventBus;
export declare function emitRunStarted(runId: string): void;
export declare function emitRunCompleted(runId: string): void;
export declare function emitRunFailed(runId: string, message: string): void;
export declare function emitRunPaused(runId: string): void;
export declare function emitRunResumed(runId: string): void;
export declare function emitStageStarted(runId: string, stage: WorkflowStage): void;
export declare function emitStageCompleted(runId: string, stage: WorkflowStage): void;
export declare function emitAgentInvoked(runId: string, agent: string, model: string): void;
export declare function emitAgentCompleted(runId: string, agent: string): void;
export declare function emitToolStarted(runId: string, tool: string): void;
export declare function emitToolCompleted(runId: string, tool: string): void;
export declare function emitValidatorStarted(runId: string, tool: string): void;
export declare function emitValidatorPassed(runId: string, tool: string): void;
export declare function emitValidatorFailed(runId: string, tool: string, issueCount: number): void;
export declare function emitIssueCreated(runId: string, issueId: string, severity: IssueSeverity, stage: WorkflowStage): void;
export declare function emitIssueResolved(runId: string, issueId: string): void;
export declare function emitRepairStarted(runId: string, attempt: number): void;
export declare function emitRepairCompleted(runId: string): void;
export declare function emitEscalationTriggered(runId: string, message: string): void;
export declare function emitContextAdded(runId: string, message: string): void;
export declare function emitArtifactSaved(runId: string, path: string): void;
export declare function streamRunEvents(runId: string, baseDir?: string, follow?: boolean): AsyncGenerator<MaikerEvent>;
export {};
//# sourceMappingURL=events.d.ts.map
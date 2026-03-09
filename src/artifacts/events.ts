import { EventEmitter } from 'events';
import fs from 'fs-extra';
import { join } from 'path';
import type { MaikerEvent, MaikerEventType, WorkflowStage, IssueSeverity } from '../types/index.js';
import { getRunDir } from '../core/state/index.js';

class MaikerEventBus extends EventEmitter {
  private logHandles: Map<string, fs.WriteStream> = new Map();

  async attachRunLog(runId: string, baseDir?: string): Promise<void> {
    const dir = getRunDir(runId, baseDir);
    await fs.ensureDir(join(dir, 'artifacts', 'logs'));
    const stream = fs.createWriteStream(
      join(dir, 'artifacts', 'logs', 'events.jsonl'),
      { flags: 'a' },
    );
    this.logHandles.set(runId, stream);
  }

  detachRunLog(runId: string): void {
    const stream = this.logHandles.get(runId);
    if (stream) {
      stream.end();
      this.logHandles.delete(runId);
    }
  }

  emit(event: string | symbol, ...args: unknown[]): boolean {
    if (event === 'maiker:event') {
      const evt = args[0] as MaikerEvent;
      const stream = this.logHandles.get(evt.runId);
      if (stream && stream.writable) {
        stream.write(JSON.stringify(evt) + '\n');
      }
    }
    return super.emit(event, ...args);
  }

  publish(evt: MaikerEvent): void {
    this.emit('maiker:event', evt);
  }
}

export const eventBus = new MaikerEventBus();

// ─── Event Builders ───────────────────────────────────────────────────────────

function baseEvent(
  type: MaikerEventType,
  runId: string,
  extra?: Partial<MaikerEvent>,
): MaikerEvent {
  return {
    type,
    runId,
    timestamp: new Date().toISOString(),
    ...extra,
  };
}

export function emitRunStarted(runId: string): void {
  eventBus.publish(baseEvent('run_started', runId));
}

export function emitRunCompleted(runId: string): void {
  eventBus.publish(baseEvent('run_completed', runId));
}

export function emitRunFailed(runId: string, message: string): void {
  eventBus.publish(baseEvent('run_failed', runId, { message }));
}

export function emitRunPaused(runId: string): void {
  eventBus.publish(baseEvent('run_paused', runId));
}

export function emitRunResumed(runId: string): void {
  eventBus.publish(baseEvent('run_resumed', runId));
}

export function emitStageStarted(runId: string, stage: WorkflowStage): void {
  eventBus.publish(baseEvent('stage_started', runId, { stage }));
}

export function emitStageCompleted(runId: string, stage: WorkflowStage): void {
  eventBus.publish(baseEvent('stage_completed', runId, { stage }));
}

export function emitAgentInvoked(
  runId: string,
  agent: string,
  model: string,
): void {
  eventBus.publish(
    baseEvent('agent_invoked', runId, { agent, data: { model } }),
  );
}

export function emitAgentCompleted(runId: string, agent: string): void {
  eventBus.publish(baseEvent('agent_completed', runId, { agent }));
}

export function emitToolStarted(runId: string, tool: string): void {
  eventBus.publish(baseEvent('tool_started', runId, { tool }));
}

export function emitToolCompleted(runId: string, tool: string): void {
  eventBus.publish(baseEvent('tool_completed', runId, { tool }));
}

export function emitValidatorStarted(runId: string, tool: string): void {
  eventBus.publish(baseEvent('validator_started', runId, { tool }));
}

export function emitValidatorPassed(runId: string, tool: string): void {
  eventBus.publish(baseEvent('validator_passed', runId, { tool }));
}

export function emitValidatorFailed(
  runId: string,
  tool: string,
  issueCount: number,
): void {
  eventBus.publish(
    baseEvent('validator_failed', runId, { tool, data: { issueCount } }),
  );
}

export function emitIssueCreated(
  runId: string,
  issueId: string,
  severity: IssueSeverity,
  stage: WorkflowStage,
): void {
  eventBus.publish(
    baseEvent('issue_created', runId, { issueId, severity, stage }),
  );
}

export function emitIssueResolved(runId: string, issueId: string): void {
  eventBus.publish(baseEvent('issue_resolved', runId, { issueId }));
}

export function emitRepairStarted(runId: string, attempt: number): void {
  eventBus.publish(
    baseEvent('repair_started', runId, { data: { attempt } }),
  );
}

export function emitRepairCompleted(runId: string): void {
  eventBus.publish(baseEvent('repair_completed', runId));
}

export function emitEscalationTriggered(runId: string, message: string): void {
  eventBus.publish(baseEvent('escalation_triggered', runId, { message }));
}

export function emitContextAdded(runId: string, message: string): void {
  eventBus.publish(baseEvent('context_added', runId, { message }));
}

export function emitArtifactSaved(runId: string, path: string): void {
  eventBus.publish(
    baseEvent('artifact_saved', runId, { data: { path } }),
  );
}

// ─── Log File Reader (for maiker logs command) ────────────────────────────────

export async function* streamRunEvents(
  runId: string,
  baseDir?: string,
  follow = false,
): AsyncGenerator<MaikerEvent> {
  const dir = getRunDir(runId, baseDir);
  const logPath = join(dir, 'artifacts', 'logs', 'events.jsonl');

  if (!(await fs.pathExists(logPath))) {
    if (!follow) return;
    // Wait for log to appear
    let waited = 0;
    while (!(await fs.pathExists(logPath)) && waited < 30000) {
      await new Promise((r) => setTimeout(r, 500));
      waited += 500;
    }
    if (!(await fs.pathExists(logPath))) return;
  }

  const content = await fs.readFile(logPath, 'utf-8');
  const lines = content.split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      yield JSON.parse(line) as MaikerEvent;
    } catch {
      // skip malformed lines
    }
  }

  if (follow) {
    // Tail mode: poll for new lines
    let offset = lines.length;
    while (true) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const updated = (await fs.readFile(logPath, 'utf-8'))
          .split('\n')
          .filter(Boolean);
        const newLines = updated.slice(offset);
        offset = updated.length;
        for (const line of newLines) {
          try {
            yield JSON.parse(line) as MaikerEvent;
          } catch {
            // skip
          }
        }
      } catch {
        // file may have rotated
      }
    }
  }
}

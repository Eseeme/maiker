import { EventEmitter } from 'events';
import fs from 'fs-extra';
import { join } from 'path';
import { getRunDir } from '../core/state/index.js';
class MaikerEventBus extends EventEmitter {
    logHandles = new Map();
    async attachRunLog(runId, baseDir) {
        const dir = getRunDir(runId, baseDir);
        await fs.ensureDir(join(dir, 'artifacts', 'logs'));
        const stream = fs.createWriteStream(join(dir, 'artifacts', 'logs', 'events.jsonl'), { flags: 'a' });
        this.logHandles.set(runId, stream);
    }
    detachRunLog(runId) {
        const stream = this.logHandles.get(runId);
        if (stream) {
            stream.end();
            this.logHandles.delete(runId);
        }
    }
    emit(event, ...args) {
        if (event === 'maiker:event') {
            const evt = args[0];
            const stream = this.logHandles.get(evt.runId);
            if (stream && stream.writable) {
                stream.write(JSON.stringify(evt) + '\n');
            }
        }
        return super.emit(event, ...args);
    }
    publish(evt) {
        this.emit('maiker:event', evt);
    }
}
export const eventBus = new MaikerEventBus();
// ─── Event Builders ───────────────────────────────────────────────────────────
function baseEvent(type, runId, extra) {
    return {
        type,
        runId,
        timestamp: new Date().toISOString(),
        ...extra,
    };
}
export function emitRunStarted(runId) {
    eventBus.publish(baseEvent('run_started', runId));
}
export function emitRunCompleted(runId) {
    eventBus.publish(baseEvent('run_completed', runId));
}
export function emitRunFailed(runId, message) {
    eventBus.publish(baseEvent('run_failed', runId, { message }));
}
export function emitRunPaused(runId) {
    eventBus.publish(baseEvent('run_paused', runId));
}
export function emitRunResumed(runId) {
    eventBus.publish(baseEvent('run_resumed', runId));
}
export function emitStageStarted(runId, stage) {
    eventBus.publish(baseEvent('stage_started', runId, { stage }));
}
export function emitStageCompleted(runId, stage) {
    eventBus.publish(baseEvent('stage_completed', runId, { stage }));
}
export function emitAgentInvoked(runId, agent, model) {
    eventBus.publish(baseEvent('agent_invoked', runId, { agent, data: { model } }));
}
export function emitAgentCompleted(runId, agent) {
    eventBus.publish(baseEvent('agent_completed', runId, { agent }));
}
export function emitToolStarted(runId, tool) {
    eventBus.publish(baseEvent('tool_started', runId, { tool }));
}
export function emitToolCompleted(runId, tool) {
    eventBus.publish(baseEvent('tool_completed', runId, { tool }));
}
export function emitValidatorStarted(runId, tool) {
    eventBus.publish(baseEvent('validator_started', runId, { tool }));
}
export function emitValidatorPassed(runId, tool) {
    eventBus.publish(baseEvent('validator_passed', runId, { tool }));
}
export function emitValidatorFailed(runId, tool, issueCount) {
    eventBus.publish(baseEvent('validator_failed', runId, { tool, data: { issueCount } }));
}
export function emitIssueCreated(runId, issueId, severity, stage) {
    eventBus.publish(baseEvent('issue_created', runId, { issueId, severity, stage }));
}
export function emitIssueResolved(runId, issueId) {
    eventBus.publish(baseEvent('issue_resolved', runId, { issueId }));
}
export function emitRepairStarted(runId, attempt) {
    eventBus.publish(baseEvent('repair_started', runId, { data: { attempt } }));
}
export function emitRepairCompleted(runId) {
    eventBus.publish(baseEvent('repair_completed', runId));
}
export function emitEscalationTriggered(runId, message) {
    eventBus.publish(baseEvent('escalation_triggered', runId, { message }));
}
export function emitContextAdded(runId, message) {
    eventBus.publish(baseEvent('context_added', runId, { message }));
}
export function emitArtifactSaved(runId, path) {
    eventBus.publish(baseEvent('artifact_saved', runId, { data: { path } }));
}
// ─── Log File Reader (for maiker logs command) ────────────────────────────────
export async function* streamRunEvents(runId, baseDir, follow = false) {
    const dir = getRunDir(runId, baseDir);
    const logPath = join(dir, 'artifacts', 'logs', 'events.jsonl');
    if (!(await fs.pathExists(logPath))) {
        if (!follow)
            return;
        // Wait for log to appear
        let waited = 0;
        while (!(await fs.pathExists(logPath)) && waited < 30000) {
            await new Promise((r) => setTimeout(r, 500));
            waited += 500;
        }
        if (!(await fs.pathExists(logPath)))
            return;
    }
    const content = await fs.readFile(logPath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    for (const line of lines) {
        try {
            yield JSON.parse(line);
        }
        catch {
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
                        yield JSON.parse(line);
                    }
                    catch {
                        // skip
                    }
                }
            }
            catch {
                // file may have rotated
            }
        }
    }
}
//# sourceMappingURL=events.js.map
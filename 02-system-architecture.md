# System Architecture

## Recommended architecture

```text
User / Developer
    ↓
mAIker CLI
    ↓
Workflow Controller
    ↓
LangGraph Orchestrator
    ↓
Agent Router
    ├─ Research Agent
    ├─ Planner Agent
    ├─ Code Agent
    ├─ Repair Agent
    ├─ Visual Review Agent
    └─ Post-Approval Review Agent
    ↓
Tool Execution Layer
    ├─ file system
    ├─ git
    ├─ package manager
    ├─ build
    ├─ lint/typecheck
    ├─ unit/integration tests
    ├─ Playwright
    └─ screenshot capture
    ↓
Validation Engine
    ↓
Repair / Escalation / Approval / Finish
```

## Why LangGraph

LangGraph should own:
- job state
- stage transitions
- retry counts
- resume behavior
- intervention handling
- escalation routing

It should **not** be the user interface.

## Why not rely only on pi-mono

pi-mono is useful as:
- worker backend
- model-routing helper
- coding-agent harness

But mAIker still needs a system that owns:
- workflow completion
- retry logic
- state and artifacts
- human escalation
- in-flight context updates

That owner should be the workflow layer.

## Core layers

### 1. CLI layer
Handles:
- commands
- output
- progress
- interactive actions

### 2. Workflow layer
Handles:
- stage graph
- state transitions
- retries
- replan decisions
- escalation decisions

### 3. Agent layer
Handles:
- reasoning and content generation
- code changes
- review
- summaries

### 4. Tool layer
Handles:
- actual execution
- shell commands
- Playwright
- build/test/lint
- file edits
- worktrees

### 5. Validation layer
Handles:
- deterministic pass/fail
- visual review
- UX rule checks
- scorecards

### 6. Artifact layer
Handles:
- screenshots
- logs
- traces
- plans
- issue files
- final reports

## Recommended model routing

- research ingestion → Gemini
- planning → strong reasoning model
- coding → Claude
- repair → Claude
- visual review → multimodal model
- post-approval review → Claude or compact review model

## Event-driven execution

The orchestrator should emit events such as:

```json
{
  "type": "stage_started",
  "stage": "validate_visual",
  "runId": "mk-001"
}
```

```json
{
  "type": "issue_created",
  "issueId": "layout-004",
  "severity": "high",
  "stage": "validate_visual"
}
```

```json
{
  "type": "context_updated",
  "runId": "mk-001",
  "impact": "medium",
  "action": "rerun_current_stage"
}
```

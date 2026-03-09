# Workflow State Machine

## Main stages

```text
INIT
INSPECT
CLASSIFY
PLAN
EXECUTE
VALIDATE_DETERMINISTIC
VALIDATE_VISUAL
REPAIR
HUMAN_ESCALATION
POST_APPROVAL_REVIEW
PROMOTE
DONE
FAILED
BLOCKED
PAUSED
```

## Recommended transitions

```text
INIT → INSPECT → CLASSIFY → PLAN → EXECUTE
EXECUTE → VALIDATE_DETERMINISTIC
VALIDATE_DETERMINISTIC → VALIDATE_VISUAL
VALIDATE_VISUAL → PASS ? POST_APPROVAL_REVIEW : REPAIR
REPAIR → VALIDATE_DETERMINISTIC
REPAIR → HUMAN_ESCALATION    when retry threshold reached
HUMAN_ESCALATION → EXECUTE   after human decision
POST_APPROVAL_REVIEW → PROMOTE
PROMOTE → DONE
Any stage → FAILED / BLOCKED / PAUSED
```

## Retry policy

```yaml
repair_policy:
  max_auto_repairs_per_issue: 3
  max_auto_repairs_per_run: 6
  max_visual_retries: 2
  escalate_on_same_failure_pattern: true
```

## Context update policy

When user injects context:
1. pause or checkpoint current node
2. write context delta
3. run impact analysis

Possible outcomes:
- low impact → continue current stage
- medium impact → rerun current stage
- high impact → replan downstream stages

## Run state shape

```json
{
  "runId": "mk-001",
  "projectPath": "./app",
  "goal": "Make dashboard mobile responsive",
  "status": "running",
  "currentStage": "validate_visual",
  "currentAgent": "visual-review",
  "currentAction": "Analyzing screenshots for nav and CTA layout",
  "retryCounts": {
    "run": 1,
    "issue:layout-004": 2
  },
  "openIssues": ["layout-004", "layout-006"],
  "lastUpdatedAt": "2026-03-08T20:00:00Z"
}
```

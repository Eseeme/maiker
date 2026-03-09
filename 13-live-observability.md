# Live Observability and In-Flight Context

## Goal

Users should always be able to see:
- what stage is running
- what the current agent is doing
- what tools are running
- what issues were found
- what files are being touched
- whether the workflow is blocked or repairing

## Event stream examples

```json
{"type":"run_started","runId":"mk-001"}
{"type":"stage_started","stage":"plan","runId":"mk-001"}
{"type":"agent_invoked","agent":"planner","model":"gpt-5.4-thinking"}
{"type":"tool_started","tool":"playwright"}
{"type":"validator_failed","issueCount":3}
{"type":"repair_started","attempt":1}
{"type":"context_added","message":"Do not modify desktop nav"}
```

## User controls

### Pause
```bash
maiker pause --run-id mk-001
```

### Resume
```bash
maiker resume --run-id mk-001
```

### Add context
```bash
maiker context add --run-id mk-001 --message "Do not touch backend API contracts"
```

### Show context history
```bash
maiker context show --run-id mk-001
```

## Impact analysis

Every context update should be classified:

- low impact → continue
- medium impact → rerun current stage
- high impact → replan downstream stages

## Safe execution summary

Do not expose raw hidden chain-of-thought.
Expose:
- current action
- evidence summary
- next action
- blockers
- retry counts

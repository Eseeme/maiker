# Agent Contracts

## Rule

Every agent must receive structured input and emit structured output.

## Research Agent

### Inputs
- goal
- repo summary
- docs and files
- screenshots or references
- constraints from user

### Outputs
- normalized brief
- assumptions
- constraints
- open questions
- evidence references

## Planner Agent

### Inputs
- normalized brief
- repo inspection
- constraints
- policy

### Outputs
- task classification
- subtask list
- acceptance criteria
- validation profile
- file target hints

## Code Agent

### Inputs
- selected subtask
- acceptance criteria
- file targets
- repo context
- no-touch constraints

### Outputs
- changed files
- implementation notes
- risk notes

## Repair Agent

### Inputs
- structured issues
- validator evidence
- touched files
- prior failed attempts

### Outputs
- minimal patch plan
- changed files
- expected impact
- residual risk

## Visual Review Agent

### Inputs
- screenshots
- viewports
- task constraints
- route metadata

### Outputs
- structured visual issues
- severity
- evidence references
- remediation hints

## Post-Approval Review Agent

### Inputs
- final diff
- validation history
- tests modified
- touched file set

### Outputs
- hidden regression findings
- scope drift findings
- suspicious code churn findings

## Human Escalation Packet

When escalation is needed, write:
- run summary
- failing issue summary
- attempts count
- what was tried
- likely root cause
- recommended human decision

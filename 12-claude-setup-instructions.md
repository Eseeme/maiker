# Claude Setup Instructions

Use this file as the handoff to Claude to scaffold the project.

## What to ask Claude to build first

Ask Claude to create a **TypeScript CLI project** named `maiker-cli` with:

- command registry
- config loader
- run folder manager
- event logger
- repo inspector
- task classifier
- LangGraph workflow shell
- agent adapters
- validator shell
- Playwright integration shell

## Suggested initial prompt to Claude

```text
Create the initial scaffold for a TypeScript CLI project named `maiker-cli`.

Requirements:
- executable command: `maiker`
- terminal-first UX
- folder structure exactly matching the provided architecture docs
- config file support using `maiker.config.yaml`
- run output stored in `.maiker/runs/<timestamp>/`
- commands to implement first:
  - init
  - configure
  - inspect
  - plan
  - run
  - validate
  - repair
  - status
  - logs
  - pause
  - resume
  - context add
- use LangGraph as the orchestration owner
- add provider adapter interfaces for:
  - Claude
  - Gemini
  - OpenAI
  - pi-mono
- include placeholder implementations where real provider auth is not yet wired
- include a typed event system
- include issue schemas and validation result schemas
- include Playwright runner shell with screenshot capture support
- do not overbuild cloud features
- target local execution first
- generate all source files and package scripts needed for a working scaffold
```

## Second prompt to Claude

```text
Using the starter pack files, implement Phase 0 and Phase 1 only:

Phase 0:
- Node/TypeScript CLI shell
- config loader
- event logger
- run folder manager
- `maiker init`
- `maiker configure`
- `maiker status`
- `maiker logs`

Phase 1:
- repo inspector
- task classifier
- `maiker inspect`
- `maiker plan`

Use clear interfaces so later phases can plug in LangGraph, Playwright, and agent adapters cleanly.
```

## Third prompt to Claude

```text
Implement the LangGraph-backed workflow shell for `maiker run` with stubbed nodes for:
- inspect
- classify
- plan
- execute
- validate_deterministic
- validate_visual
- repair
- human_escalation
- post_approval_review
- promote

Persist run state to `.maiker/runs/<run-id>/state.json`.
Emit structured events that can later drive `maiker logs --follow`.
```

# Implementation Plan

## Phase 0 — Foundation

Build:
- Node/TypeScript CLI shell
- config loader
- run folder manager
- event logger
- base command registry

Commands:
- init
- configure
- status
- logs

## Phase 1 — Repo inspection and planning

Build:
- repo inspector
- task classifier
- planner agent adapter
- validation profile generator

Commands:
- inspect
- plan

## Phase 2 — Execution pipeline

Build:
- workflow state machine
- LangGraph orchestration
- code agent adapter
- shell execution
- git worktree helper

Commands:
- run

## Phase 3 — Deterministic validation

Build:
- build/lint/typecheck runners
- test runner
- Playwright runner
- screenshot capture

Commands:
- validate

## Phase 4 — AI review and repair

Build:
- visual review agent
- repair agent
- issue store
- bounded retry policy

Commands:
- repair

## Phase 5 — Human control

Build:
- pause/resume
- context add/show
- escalation packet generation
- post-approval review

Commands:
- pause
- resume
- context add
- review

## Phase 6 — Optional UI

Build:
- local dashboard
- live event stream
- artifacts viewer
- issue pane
- context injection panel

## First end-to-end milestone

Support one complete scenario:
- existing Next.js app
- goal: make dashboard mobile responsive
- run Playwright E2E
- capture screenshots
- repair top 3 layout issues
- package final report

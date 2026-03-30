# mAIker — Master Registry

> Single source of truth for everything mAIker offers: agents, CLI commands, validators, scripts, skills, and automation pipelines.

**Version:** 0.1.0 | **Status:** Alpha → Beta | **Engine:** LangGraph + SqliteSaver

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        CLI (commander)                           │
│  init │ run │ plan │ validate │ repair │ review │ status │ auth  │
└────────────────────────────┬─────────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────────┐
│              Orchestrator (LangGraph StateGraph)                  │
│                                                                  │
│  INIT → INSPECT → CLASSIFY → PLAN → EXECUTE (parallel fan-out)  │
│    → VALIDATE_DETERMINISTIC → VALIDATE_VISUAL                    │
│    → REPAIR (bounded loop) → HUMAN_ESCALATION                   │
│    → POST_APPROVAL_REVIEW → PROMOTE → DONE                      │
│                                                                  │
│  Durable checkpoints: SqliteSaver (.maiker/checkpoints.db)       │
└────────────────────────────┬─────────────────────────────────────┘
                             │
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                  ▼
    ┌──────────┐     ┌──────────────┐    ┌───────────┐
    │  Agents  │     │  Validators  │    │   Tools   │
    │ (6 roles)│     │ (11 + 3 planned) │ │ (7 groups)│
    └──────────┘     └──────────────┘    └───────────┘
          │                  │                  │
          ▼                  ▼                  ▼
    ┌──────────┐     ┌──────────────┐    ┌───────────┐
    │Providers │     │  Artifacts   │    │  Config   │
    │ (4 LLMs) │     │ (.maiker/)   │    │  (YAML)   │
    └──────────┘     └──────────────┘    └───────────┘
```

---

## Agents

| # | Agent | File | Model Recommendation | Purpose |
|---|-------|------|---------------------|---------|
| 1 | **Research** | `src/agents/research/index.ts` | Gemini 2.5 Pro (1M context) | Ingest docs, normalize requirements, produce structured briefing |
| 2 | **Planner** | `src/agents/planner/index.ts` | Claude Opus 4.6 / o3 | Generate execution plan with subtasks, acceptance criteria, validation profile |
| 3 | **Coder** | `src/agents/coder/index.ts` | Claude Sonnet 4.6 | Implement subtasks in parallel, respect file targets and no-touch zones |
| 4 | **Repair** | `src/agents/repair/index.ts` | Claude Sonnet 4.6 | Analyze validation failures, create minimal patches, bounded retries |
| 5 | **Visual Review** | `src/agents/visual/index.ts` | GPT-4o / Claude | Analyze screenshots across viewport matrix, identify layout/UX violations |
| 6 | **Post-Approval Review** | `src/agents/review/index.ts` | Claude Haiku 4.5 / GPT-4o-mini | Scan final diff for regressions, scope drift, suspicious churn |

**Shared infrastructure:** `src/agents/shared/tool-loop.ts` — unified provider-agnostic tool execution loop. All providers (Claude, OpenAI, Gemini, pi-mono) go through the same tool protocol with security guards and policy hooks.

**Execution safety:** `src/core/guards/index.ts` — path sandboxing, command allow/deny lists, secret scanning, no-touch zone enforcement.

---

## CLI Commands

| Command | File | Description |
|---------|------|-------------|
| `maiker init` | `src/cli/commands/init.ts` | Initialize project: detect framework, select models, generate config |
| `maiker run <path> --goal <text>` | `src/cli/commands/run.ts` | Execute full workflow end-to-end |
| `maiker plan <path> --goal <text>` | `src/cli/commands/plan.ts` | Plan only (no execution) |
| `maiker inspect <path>` | `src/cli/commands/inspect.ts` | Analyze repository structure |
| `maiker validate <path>` | `src/cli/commands/validate.ts` | Run validators only |
| `maiker repair` | `src/cli/commands/repair.ts` | Re-run repair loop on latest run |
| `maiker review` | `src/cli/commands/review.ts` | Trigger post-approval review |
| `maiker status [--all]` | `src/cli/commands/status.ts` | Show run status |
| `maiker logs [--follow]` | `src/cli/commands/logs.ts` | View live logs |
| `maiker pause` | `src/cli/commands/pause.ts` | Pause current run |
| `maiker resume` | `src/cli/commands/resume.ts` | Resume from checkpoint |
| `maiker context add --message <text>` | `src/cli/commands/context.ts` | Inject context mid-run |
| `maiker artifacts` | `src/cli/commands/artifacts.ts` | Show artifacts directory |
| `maiker configure` | `src/cli/commands/configure.ts` | Update maiker.config.yaml |
| `maiker auth [--validate]` | `src/cli/commands/auth.ts` | Check API keys & OAuth status |
| `maiker auth refresh` | `src/cli/commands/auth.ts` | Re-detect Claude Code OAuth token |
| `maiker selfcheck` | `src/cli/commands/selfcheck.ts` | Validate maiker's own health (build, types, config, deps) |

---

## Validators

### Deterministic (pass/fail)

| Validator | Purpose |
|-----------|---------|
| `install` | Package manager install succeeds |
| `build` | Build command (webpack, esbuild, tsc) passes |
| `lint` | ESLint or configured linter passes |
| `typecheck` | TypeScript type checking passes |
| `unit_tests` | Jest/Vitest unit tests pass |
| `integration_tests` | Cross-service tests pass |
| `playwright_e2e` | End-to-end browser tests pass |
| `lockfile_sanity` | Dependency versions consistent |
| `regression_tests` | Regression test suite passes |

### AI-Based (implemented)

| Validator | Purpose | Status |
|-----------|---------|--------|
| `screenshot_capture` | Playwright captures at configured viewports | Implemented |
| `visual_review` | LLM analyzes screenshots for layout/UX issues | Implemented |

### AI-Based (planned)

| Validator | Purpose | Status |
|-----------|---------|--------|
| `ux_rules` | Application of UX constraints from task brief | Planned — currently triggers visual_review |
| `accessibility` | Accessibility rule checking | Planned |
| `mobile_layout_rules` | Mobile-specific layout validation | Planned |

### Validation Profiles (auto-selected by task type)

| Task Type | Required | Optional |
|-----------|----------|----------|
| Mobile Responsive | build, lint, typecheck, playwright_e2e, screenshot, visual_review, ux_rules | accessibility |
| Framework Upgrade | install, build, lint, typecheck, unit_tests, integration_tests, playwright_e2e | screenshot, visual_review |
| Bugfix | build, lint, typecheck | unit_tests |
| Feature Work | build, lint, typecheck, unit_tests, integration_tests | playwright_e2e |

---

## Providers

| Provider | File | Models | Auth |
|----------|------|--------|------|
| **Claude** | `src/providers/claude/index.ts` | Opus 4.6, Sonnet 4.6, Haiku 4.5 | OAuth auto-detect or `ANTHROPIC_API_KEY` |
| **OpenAI** | `src/providers/openai/index.ts` | o3, GPT-4o, GPT-4o-mini, Codex-mini | `OPENAI_API_KEY` |
| **Gemini** | `src/providers/gemini/index.ts` | Gemini 2.5 Pro, Gemini 2.5 Flash | `GOOGLE_API_KEY` |
| **Pi-Mono** | `src/providers/pi-mono/index.ts` | Custom | Custom |

---

## Tools

| Group | File | Capabilities |
|-------|------|-------------|
| **Shell** | `src/tools/shell/` | Command execution with timeout and output capture |
| **Git** | `src/tools/git/` | Status, diff, commit, worktree management |
| **Filesystem** | `src/tools/filesystem/` | Read, write, glob, directory traversal |
| **Package** | `src/tools/package/` | Install, add/remove deps, lockfile ops |
| **Playwright** | `src/tools/playwright/` | Browser automation, screenshot capture, trace recording |
| **Testing** | `src/tools/testing/` | Jest/Vitest/Playwright test runners |
| **Diff** | `src/tools/diff/` | Diff analysis and patch generation |

---

## Scripts

| Script | File | Purpose |
|--------|------|---------|
| **bootstrap.sh** | `scripts/bootstrap.sh` | One-command setup: npm install, build, link globally |
| **check-env.sh** | `scripts/check-env.sh` | Verify Node.js, npm, API keys, Playwright |
| **install-playwright.sh** | `scripts/install-playwright.sh` | Install Playwright browsers |

---

## Templates

| Template | File | Purpose |
|----------|------|---------|
| **Config** | `templates/maiker.config.yaml` | Example configuration file |
| **Research prompt** | `templates/prompts/research-agent.md` | Research agent system prompt |
| **Planner prompt** | `templates/prompts/planner-agent.md` | Planner agent system prompt |
| **Repair prompt** | `templates/prompts/repair-agent.md` | Repair agent system prompt |
| **Default policy** | `templates/policies/default.yaml` | Default retry/escalation policies |
| **Final summary** | `templates/reports/final-summary.md` | Run summary report template |

---

## Policies & Error Handling

| Policy | Default | Purpose |
|--------|---------|---------|
| `maxAutoRepairsPerIssue` | 3 | Max repair attempts per single issue |
| `maxAutoRepairsPerRun` | 6 | Max total repair attempts per run |
| `maxVisualRetries` | 2 | Max visual review retry cycles |
| `requireHumanApproval` | true | Require human approval before promote |
| `postApprovalReviewRequired` | true | Run post-approval review agent |
| `stopOnBuildFailure` | false | Halt all validation if build fails |

**Error categories:** `auth` (abort) → `transient` (auto-retry) → `resource` (escalate) → `dependency` (repair) → `validation` (repair loop) → `code_generation` (retry) → `unknown` (escalate after 1)

---

## Self-Check (`maiker selfcheck`)

Built-in health check command that validates maiker itself:

| Check | What it does |
|-------|-------------|
| **TypeScript** | `tsc --noEmit` — zero type errors |
| **Build** | `npm run build` — dist/ compiles clean |
| **Dependencies** | `npm ls` — no missing or broken deps |
| **Config schema** | Validates maiker.config.yaml against Zod schema |
| **Git status** | Reports uncommitted changes |
| **Auth** | Verifies at least one provider has valid credentials |

---

## Periodic Review Agent

Scheduled agent that monitors your product/website and feeds improvements back into maiker.

### Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                  Periodic Review Pipeline                        │
│                                                                 │
│  ┌─────────┐    ┌──────────┐    ┌──────────┐    ┌───────────┐ │
│  │ Collect  │───▶│ Analyze  │───▶│  Human   │───▶│  Apply    │ │
│  │ (scrape, │    │ (compare │    │  Review  │    │  (update  │ │
│  │  fetch)  │    │  & diff) │    │  (triage)│    │  maiker)  │ │
│  └─────────┘    └──────────┘    └──────────┘    └───────────┘ │
│       │              │               │               │         │
│       ▼              ▼               ▼               ▼         │
│  .maiker/reviews/  findings/     decisions/      applied/      │
│  YYYY-MM-DD/       report.md     approved.md     changelog.md  │
└─────────────────────────────────────────────────────────────────┘
```

### Folder Structure

```
.maiker/reviews/
├── YYYY-MM-DD-HHMMSS/           # One folder per review cycle
│   ├── snapshot.json            # Raw data collected (URLs, content, screenshots)
│   ├── findings.md              # AI analysis: what changed, what's new, recommendations
│   ├── architecture-delta.md    # Suggested changes to maiker architecture
│   ├── decision.md              # Human triage: approved / rejected / deferred per finding
│   └── applied.md               # What was actually applied and when
├── review-config.yaml           # Review schedule, URLs to monitor, comparison rules
├── changelog.md                 # Running log of all applied changes
└── backlog.md                   # Deferred findings awaiting future review
```

### Usage

```bash
# Run a review cycle manually
maiker review-cycle --url https://myproduct.com --compare-with latest

# List pending findings awaiting human review
maiker review-cycle --status pending

# Apply approved findings
maiker review-cycle --apply approved

# Schedule periodic reviews (via cron or Claude Code scheduled agent)
# See: .maiker/reviews/review-config.yaml
```

---

## Documentation

| Doc | File | Contents |
|-----|------|----------|
| Product Overview | `01-product-overview.md` | Vision, use cases, principles |
| System Architecture | `02-system-architecture.md` | Component design, data flow |
| Folder Structure | `03-folder-structure.md` | Directory layout spec |
| CLI Command Design | `04-cli-command-design.md` | Command contracts and UX |
| Workflow State Machine | `05-workflow-state-machine.md` | LangGraph stages and transitions |
| Validation Profiles | `06-validation-profiles.md` | Validator selection logic |
| Agent Contracts | `07-agent-contracts.md` | Agent I/O schemas |
| Prompt Pack | `08-prompt-pack.md` | System prompts for each agent |
| Config Schema | `09-config-schema.md` | Configuration reference |
| Implementation Plan | `10-implementation-plan.md` | Build phases and milestones |
| UI v1/v2 | `11-ui-v1-v2.md` | Dashboard design (planned) |
| Claude Setup | `12-claude-setup-instructions.md` | Setup guide for Claude Code |
| Live Observability | `13-live-observability.md` | Event streaming and monitoring |
| **Master Registry** | `MAIKER.md` | **This file — everything in one place** |

---

## Quick Start

```bash
# 1. Install
cd maiker && npm install && npm run build && sudo npm link

# 2. Initialize a project
cd /path/to/your-app && maiker init

# 3. Run a task
maiker run . --goal "Make the dashboard mobile responsive"

# 4. Check health
maiker selfcheck

# 5. Review product changes
maiker review-cycle --url https://myproduct.com
```

---

## Roadmap to Production

- [x] LangGraph orchestration with durable checkpoints
- [x] 6 specialized agents with model routing
- [x] Deterministic + AI validation engine
- [x] Bounded retry with escalation policies
- [x] OAuth auto-detect (Claude Code)
- [x] CLI with 15+ commands
- [x] Error classification and auth abort
- [ ] **Test suite** (vitest — in progress)
- [ ] **Self-check command** (in progress)
- [ ] **Periodic review agent** (in progress)
- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Pause/resume with full checkpoint restore
- [ ] Local dashboard UI
- [ ] Incremental repo inspection (cache between runs)
- [ ] File-scoped context windows for large repos

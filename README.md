# mAIker — AI-Powered Product Engineering CLI

**mAIker** is a local-first CLI that uses AI agents to inspect your repository, plan changes, execute subtasks **in parallel**, validate results with Playwright, auto-repair issues, and package a final report — all from your terminal.

```
maiker run ./my-app --goal "Make the dashboard mobile responsive without breaking desktop"
```

---

## Table of Contents

- [How It Works](#how-it-works)
- [Part 1 — Install mAIker on your machine](#part-1--install-maiker-on-your-machine)
- [Part 2 — Set up your API keys](#part-2--set-up-your-api-keys)
- [Part 3 — Point mAIker at your project](#part-3--point-maiker-at-your-project)
- [Part 4 — Run it](#part-4--run-it)
- [Pre-flight Confirmation](#pre-flight-confirmation)
- [Parallel Execution](#parallel-execution)
- [Repair Loop and Auto-Recovery](#repair-loop-and-auto-recovery)
- [Watching a run live (two terminals)](#watching-a-run-live-two-terminals)
- [CLI Command Reference](#cli-command-reference)
- [Configuration Reference](#configuration-reference)
- [Model Routing](#model-routing)
- [Workflow Stages](#workflow-stages)
- [Validation Profiles](#validation-profiles)
- [Architecture Overview](#architecture-overview)
- [Project Structure](#project-structure)
- [Contributing](#contributing)

---

## How It Works

mAIker is a **global CLI tool** you install once on your machine (like `git` or `npm`).
After installation, you point it at **any project on your computer** and give it a goal.

```
[maiker repo]  →  npm install + npm run build + npm link  →  maiker command available globally
      ↓
[your project]  →  maiker init  →  maiker run ./. --goal "..."
```

There is **no second terminal needed during installation**. The second terminal is only useful if you want to watch live logs while a run is executing.

---

## Part 1 — Install mAIker on your machine

Do this **once**, inside the `maiker` repository folder (the folder you cloned).

### Step 1 — Make sure you have Node.js 20+

```bash
node --version
# Should show v20.x.x or higher
# If not: https://nodejs.org
```

### Step 2 — Install dependencies

```bash
# You are inside the maiker repo folder
npm install
```

This installs all packages listed in `package.json`. Wait for it to finish completely.

### Step 3 — Build the TypeScript source

```bash
npm run build
```

This compiles all `.ts` files into `dist/`. You should see no errors.

### Step 4 — Link the `maiker` command globally

```bash
npm link
```

This registers the `maiker` command on your machine globally — exactly like installing a CLI with `npm install -g`. After this, you can type `maiker` in **any terminal, any folder**.

### Step 5 — Verify it works

```bash
maiker --help
```

You should see the full command list. If you do, installation is complete.

### Optional — Install Playwright browsers (needed for E2E + screenshots)

```bash
./scripts/install-playwright.sh
```

Only needed if you want Playwright E2E testing and screenshot capture. This downloads browser binaries (Chromium by default). Takes a few minutes on first run.

### Optional — Check your environment

```bash
./scripts/check-env.sh
```

Runs a full environment check: Node version, API keys, Playwright, build output, linked binary.

---

## Part 2 — Set up your API keys

mAIker needs API keys to call AI models. By default, **all agent roles use Claude**, so you only need one key to get started.

Create a `.env` file **inside the maiker repo folder**:

```bash
# Still inside the maiker repo folder
cp .env.example .env
```

Then open `.env` and add your Anthropic key:

```bash
# Anthropic Claude — default provider for ALL roles
ANTHROPIC_API_KEY=sk-ant-api03-...
```

That's it. All six agent roles (research, planner, coder, repair, visual review, post-approval) will use Claude by default.

**Want to use other providers for specific roles?** Add their keys too:

```bash
# OpenAI — add if you route any role to openai (e.g. visual_review → openai/gpt-4o)
OPENAI_API_KEY=sk-proj-...

# Google Gemini — add if you route any role to gemini (e.g. research → gemini/gemini-2.5-pro)
GOOGLE_API_KEY=AIza...
```

Then change the specific role in `maiker.config.yaml` — see [Model Routing](#model-routing).

---

## Part 3 — Point mAIker at your project

Now open a terminal **inside your actual project** (not the maiker repo).

```bash
cd /path/to/your-app
```

### Step 1 — Initialise mAIker in your project

```bash
maiker init
```

This creates a `.maiker/` folder inside your project and generates a `maiker.config.yaml` config file. It does not touch any of your source code.

Your project folder will now look like:

```
your-app/
├── maiker.config.yaml    ← created by maiker init
├── .maiker/              ← created by maiker init
│   └── runs/             ← run outputs will go here
├── src/
├── package.json
└── ...your files...
```

### Step 2 — Edit the config (optional for first run)

```bash
# Open maiker.config.yaml in your editor
# The defaults work for most projects
```

The key settings most people change:

```yaml
playwright:
  base_url: http://localhost:3000   # change to match your dev server port
  routes:
    - /
    - /dashboard                    # add your actual routes here

policies:
  require_human_approval: false     # set to false to skip manual approval step
```

### Step 3 — Inspect your project (optional but recommended)

```bash
maiker inspect .
```

This scans your project and shows what mAIker detected: framework, package manager, routes, test setup. Good way to confirm everything is recognised correctly before running.

---

## Part 4 — Run it

You are now inside your project folder with `maiker init` done.

### The basic command

```bash
maiker run . --goal "your goal in plain English"
```

The `.` means "this folder". You can also point to any path:

```bash
maiker run ./app --goal "..."
maiker run /Users/you/projects/myapp --goal "..."
```

### Real examples

```bash
# Make a UI mobile responsive
maiker run . --goal "Make the dashboard mobile responsive without breaking desktop"

# Upgrade a framework
maiker run . --goal "Upgrade Next.js from 14 to 15 and validate no regressions"

# Fix a specific bug
maiker run . --goal "Fix CTA button overflow on mobile viewports below 390px"

# Add a feature
maiker run . --goal "Add a search bar to the header that filters the table"
```

### Skip the pre-flight check

```bash
maiker run . --goal "..." --yes
```

### If a run gets blocked

If mAIker can't auto-repair an issue after the retry limit, it pauses and writes a human review file:

```
.maiker/runs/<run-id>/review/human-review.md
```

Open that file, read the summary, then resume:

```bash
maiker resume --run-id <the-run-id-shown>
```

---

## Pre-flight Confirmation

Before every run, mAIker shows a **pre-flight screen** so you can verify which models will be used for each step:

```
  Pre-flight check
  ────────────────────────────────────────

  Run ID:   mk-2026-03-09_12-24-00-90fe8341
  Project:  /home/you/projects/my-app
  Goal:     Make the dashboard mobile responsive

  Agent Model Routing

  Research ingestion     claude  claude-sonnet-4-6
  Planner                claude  claude-sonnet-4-6
  Code generation        claude  claude-sonnet-4-6
  Repair                 claude  claude-sonnet-4-6
  Visual review          claude  claude-sonnet-4-6
  Post-approval review   claude  claude-sonnet-4-6

  Validators

  install  build  lint  typecheck  unit_tests  playwright_e2e
  screenshot_capture  visual_review  ux_rules
  skipped: integration_tests, accessibility, lockfile_sanity

  Policies

  Max repairs / issue:  3
  Max repairs / run:    6
  Human approval:       required
  Post-approval review: enabled

  To change any model: edit maiker.config.yaml → models section
  To skip this check:  add --yes to the run command

  Proceed with these settings? [Y/n]
```

Press Enter (or `y`) to proceed, or `n` to abort and edit your config first. In CI/non-TTY environments, it defaults to yes automatically.

---

## Parallel Execution

mAIker does **not** run subtasks sequentially. The planner agent generates a **dependency graph** for subtasks, and the orchestrator executes independent subtasks **in parallel**.

### How it works

The planner outputs subtasks with a `dependsOn` field declaring which subtasks must complete first:

```
Subtask A (dependsOn: [])              ← no deps, starts immediately
Subtask B (dependsOn: [])              ← no deps, starts immediately
Subtask C (dependsOn: ["A"])           ← waits for A
Subtask D (dependsOn: ["A", "B"])      ← waits for both A and B
Subtask E (dependsOn: ["C", "D"])      ← waits for C and D
```

The orchestrator computes **execution waves**:

```
Wave 1: [A, B]     → run in parallel (no deps)
Wave 2: [C]        → runs after A completes
Wave 3: [D]        → runs after A and B complete
Wave 4: [E]        → runs after C and D complete
```

During a run, you'll see:

```
[maiker] Execution plan: 4 wave(s), 5 subtask(s)
[maiker]   Wave 1: [subtask-1, subtask-2] (2 parallel)
[maiker]   Wave 2: [subtask-3] (1 parallel)
[maiker]   Wave 3: [subtask-4] (1 parallel)
[maiker]   Wave 4: [subtask-5] (1 parallel)
```

### Shared context between parallel tasks

When a subtask completes, it publishes its results to a **shared context**:

- **Changed files** — so the next subtask knows what files already exist or were modified
- **Implementation notes** — so the next agent knows what was built and can reference it

This means subtask C can see what subtask A created and build on it, even though they were planned independently.

### File conflict safety

If two subtasks in the same wave target the **same file**, mAIker detects the conflict and falls back to running them sequentially within that wave. This prevents two agents from overwriting each other's work.

### Git checkpoints

Before execution begins, mAIker creates a **git checkpoint** (lightweight tag). If something goes catastrophically wrong, the checkpoint provides a rollback point. The checkpoint is automatically cleaned up after a successful run.

---

## Repair Loop and Auto-Recovery

When validation fails, mAIker enters a bounded repair loop. Here's exactly how it works:

### Per-issue tracking

Each failing validator creates its own **individual issue** (not one aggregate issue for all failures). For example, if both `build` and `lint` fail, you get two separate issues:

```
build-a1b2c3d4:  build: Cannot find module './Button'
lint-e5f6g7h8:   lint: 'useState' is defined but never used
```

Each issue gets its **own retry budget** (default: 3 attempts).

### Issue resolution

When a validator that previously failed now **passes**, its issue is automatically resolved:

```
[maiker] ✓ Resolved issue build-a1b2c3d4 (build now passes)
```

This means:
- Fixed issues stop consuming retry budget
- The repair agent only sees issues that are **still open**
- New issues from later validation cycles get **fresh retry budgets**

### Repair agent intelligence

The repair agent receives:

- **Per-issue attempt counts** — knows this is attempt 2 of 3 for a specific issue
- **Previous repair notes** — knows what was already tried and can take a different approach
- **Progress tracking** — the system logs whether repairs are improving or regressing:

```
[maiker] ↓ Progress: 3 → 1 open issues
[maiker] ⚠ Regression detected: 4 open issues (was 2)
```

### Auto-replan

If 50% of the total repair budget is exhausted without resolving issues, mAIker goes back to the **PLAN** stage instead of continuing to burn retries. This gives the planner a chance to take a different approach.

### Budget limits

```yaml
policies:
  max_auto_repairs_per_issue: 3   # each issue gets 3 attempts
  max_auto_repairs_per_run: 6     # hard cap on total repair attempts
```

Example scenario:

```
Issue A (build):    attempt 1 → attempt 2 → passes ✓     (2 used)
Issue B (lint):     attempt 1 → attempt 2 → attempt 3 ✓  (3 used, 5 total)
Issue C (typecheck): attempt 1 → ESCALATES                (6 total limit hit)
```

When limits are hit, mAIker writes a human review packet and pauses:

```
.maiker/runs/<id>/review/human-review.md
```

The escalation packet includes:
- All open issues with attempt counts
- Everything the repair agent already tried
- Likely root cause analysis
- Recommended next steps

---

## Watching a run live (two terminals)

This is the recommended way to run mAIker so you can see what it's doing in real time.

**Terminal 1 — start the run:**

```bash
cd /path/to/your-app
maiker run . --goal "Make the dashboard mobile responsive"
```

**Terminal 2 — watch live events (open this right after):**

```bash
cd /path/to/your-app
maiker logs --follow
```

Terminal 2 shows a live stream of every event: which stage is running, which agent was called, which validators passed or failed, which issues were created.

**Adding context while a run is in progress:**

If you notice something important while the run is going, inject it from Terminal 2 without stopping the run:

```bash
maiker context add --message "Do not modify the desktop navigation bar"
maiker context add --message "The /settings route is not important, focus on /dashboard"
```

mAIker analyses the impact and either continues, reruns the current stage, or replans — all without stopping.

---

## CLI Command Reference

### Setup

| Command | What it does |
|---------|-------------|
| `maiker init` | Creates `.maiker/` and `maiker.config.yaml` in your current project |
| `maiker configure --show` | Prints current config |
| `maiker configure --set key=value` | Sets a config value |

### Analysis

| Command | What it does |
|---------|-------------|
| `maiker inspect <path>` | Detects framework, package manager, routes, hotspots |
| `maiker plan <path> --goal "..."` | Generates a plan without executing anything |

### Execution

| Command | What it does |
|---------|-------------|
| `maiker run <path> --goal "..."` | Runs the full workflow end to end |
| `maiker run <path> --goal "..." --yes` | Runs without pre-flight confirmation |
| `maiker validate <path>` | Runs validators only (no code changes) |
| `maiker repair <path> --run-id <id>` | Applies targeted repairs from an existing issue list |
| `maiker review <path> --run-id <id>` | Runs post-approval regression review only |

### Monitoring

| Command | What it does |
|---------|-------------|
| `maiker status` | Shows status of the most recent run |
| `maiker status --run-id <id>` | Shows status of a specific run |
| `maiker status --all` | Lists all runs with status |
| `maiker logs` | Prints the event log for the most recent run |
| `maiker logs --follow` | Tails the event log live |
| `maiker logs --run-id <id> --follow` | Tails log for a specific run |
| `maiker artifacts list` | Lists all artifacts for the most recent run |
| `maiker artifacts list --run-id <id>` | Lists artifacts for a specific run |

### Control

| Command | What it does |
|---------|-------------|
| `maiker pause` | Pauses the current run at the next safe checkpoint |
| `maiker pause --run-id <id>` | Pauses a specific run |
| `maiker resume` | Resumes the most recently paused run |
| `maiker resume --run-id <id>` | Resumes a specific run |
| `maiker context add --message "..."` | Injects a constraint or update into the running workflow |
| `maiker context show` | Shows all context updates injected into the current run |

### Key flags

```bash
--goal "<text>"     # What you want mAIker to do (required for run and plan)
--run-id <id>       # Target a specific run by ID
--config <path>     # Use a specific config file instead of maiker.config.yaml
--verbose           # Show every event in detail
--dry-run           # Plan only, make no code changes
--yes               # Skip the pre-flight confirmation prompt
--follow            # Tail log output live
--json              # Output as machine-readable JSON
--max-retries <n>   # Override max repair attempts per run
```

---

## Configuration Reference

`maiker.config.yaml` lives in your project root (created by `maiker init`).

```yaml
project:
  name: my-product
  root: .
  framework: auto          # auto | nextjs | react | vue | nuxt | angular | svelte | express
  package_manager: auto    # auto | npm | yarn | pnpm | bun

# ─── Agent Model Routing ──────────────────────────────────────────────────────
# Each agent role has its own provider and model.
# Default: all Claude so you only need one API key to start.
# Every role is independently swappable — change provider and model per role.
# Built-in providers: claude | openai | gemini | pi-mono
#
# Examples of what you might use per role:
#   research_ingestion  → gemini/gemini-2.5-pro  (good at large context ingestion)
#   planner             → openai/o1              (strong reasoning)
#   code_generation     → claude/claude-sonnet-4-6 or openai/codex-mini
#   repair_agent        → claude/claude-sonnet-4-6 (good at targeted diffs)
#   visual_review       → openai/gpt-4o          (multimodal, good at screenshots)
#   post_approval       → claude/claude-haiku-4-5 (fast, cheap review)
models:
  research_ingestion:
    provider: claude
    model: claude-sonnet-4-6
  planner:
    provider: claude
    model: claude-sonnet-4-6
  code_generation:
    provider: claude
    model: claude-sonnet-4-6
  repair_agent:
    provider: claude
    model: claude-sonnet-4-6
  visual_review:
    provider: claude
    model: claude-sonnet-4-6
  post_approval_review:
    provider: claude
    model: claude-sonnet-4-6

# Which validators are enabled
validators:
  install: true
  build: true
  lint: true
  typecheck: true
  unit_tests: true
  integration_tests: false
  playwright_e2e: true
  screenshot_capture: true
  visual_review: true
  ux_rules: true
  accessibility: false
  lockfile_sanity: false
  regression_tests: false
  mobile_layout_rules: false

# Playwright settings for E2E and screenshots
playwright:
  base_url: http://localhost:3000    # your dev server URL
  viewports:
    - [320, 568]
    - [375, 667]
    - [390, 844]
    - [768, 1024]
  routes:
    - /
    - /dashboard
    - /settings
  timeout: 30000

# Repair and approval behaviour
policies:
  require_human_approval: true          # pause and wait before promoting
  post_approval_review_required: true   # run regression scan after approval
  max_auto_repairs_per_issue: 3         # retry limit per issue
  max_auto_repairs_per_run: 6           # total repair budget per run
  max_visual_retries: 2
  stop_on_build_failure: false

# Where run outputs are stored
artifacts:
  output_dir: .maiker/runs
  save_screenshots: true
  save_playwright_trace: true
  save_diff_reports: true
```

### Mixing providers (example: Claude + Gemini + OpenAI)

```yaml
models:
  research_ingestion:
    provider: gemini
    model: gemini-2.5-pro          # large context window for repo ingestion
  planner:
    provider: openai
    model: o1                      # strong reasoning for planning
  code_generation:
    provider: claude
    model: claude-sonnet-4-6       # code generation
  repair_agent:
    provider: claude
    model: claude-sonnet-4-6       # targeted diffs
  visual_review:
    provider: openai
    model: gpt-4o                  # multimodal screenshot review
  post_approval_review:
    provider: claude
    model: claude-haiku-4-5        # fast, cheap regression scan
```

This requires `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and `GOOGLE_API_KEY` in your `.env`.

---

## Model Routing

Every agent role is **independently configurable**. You can mix and match providers per role.

| Role | Default Provider | Default Model | What it does |
|------|-----------------|---------------|-------------|
| Research ingestion | claude | claude-sonnet-4-6 | Ingests goal + repo context |
| Planner | claude | claude-sonnet-4-6 | Creates subtask dependency graph |
| Code generation | claude | claude-sonnet-4-6 | Implements code changes |
| Repair | claude | claude-sonnet-4-6 | Fixes validator failures |
| Visual review | claude | claude-sonnet-4-6 | Reviews Playwright screenshots |
| Post-approval review | claude | claude-sonnet-4-6 | Scans for hidden regressions |

**Built-in providers:** `claude`, `openai`, `gemini`, `pi-mono`

You can add your own provider adapter in `src/providers/` and use any provider name in config.

To change a role, edit `maiker.config.yaml` → `models` section. The pre-flight screen will show you what's configured before every run.

---

## Workflow Stages

```
INIT → INSPECT → CLASSIFY → PLAN → EXECUTE (parallel subtasks)
  └─ EXECUTE → VALIDATE_DETERMINISTIC
       ├─ pass → resolve issues → VALIDATE_VISUAL
       │    ├─ pass → POST_APPROVAL_REVIEW → PROMOTE → DONE
       │    └─ high/critical issues → REPAIR
       └─ fail → create per-validator issues → REPAIR
                   ├─ retry budget ok → VALIDATE_DETERMINISTIC  (repair loop)
                   ├─ 50% budget used → PLAN  (auto-replan)
                   └─ budget exhausted → HUMAN_ESCALATION → BLOCKED
                                           └─ after maiker resume → EXECUTE
  Any stage → FAILED | PAUSED
```

### What happens at each stage

| Stage | What it does |
|-------|-------------|
| **INSPECT** | Scans repo: framework, package manager, routes, hotspots, test setup |
| **CLASSIFY** | Identifies task type (mobile-redesign, feature-work, bugfix, etc.) and risk level |
| **PLAN** | AI planner generates subtasks with dependency graph and acceptance criteria |
| **EXECUTE** | Runs subtasks in parallel waves. Each wave waits for its dependencies. Shared context propagates between waves. Git checkpoint created for rollback. |
| **VALIDATE_DETERMINISTIC** | Runs build, lint, typecheck, tests. Per-validator issues created. Resolved issues cleared. |
| **VALIDATE_VISUAL** | Runs Playwright E2E, captures screenshots, AI visual review |
| **REPAIR** | Repair agent gets open issues + per-issue attempt counts + history of prior repairs. Tries different approach on repeat attempts. |
| **HUMAN_ESCALATION** | Writes escalation packet with all context and pauses for human |
| **POST_APPROVAL_REVIEW** | Scans for hidden regressions and scope drift |
| **PROMOTE** | Writes final summary, cleans up git checkpoint |

---

## Validation Profiles

The set of validators that run is chosen automatically based on the task type detected from your goal.

| Task type | Validators that run |
|-----------|-------------------|
| Mobile responsive redesign | build, lint, typecheck, playwright_e2e, screenshot_capture, visual_review, ux_rules |
| Framework upgrade | install, build, lint, typecheck, unit_tests, integration_tests, playwright_e2e, lockfile_sanity |
| Feature work | build, lint, typecheck, unit_tests, playwright_e2e |
| Bugfix | build, lint, typecheck |
| Refactor | build, lint, typecheck, unit_tests |

You can override which validators run by editing the `validators:` section in `maiker.config.yaml`.

---

## Architecture Overview

```
User / Developer
    ↓
mAIker CLI  (commander.js)
    ↓
Pre-flight Screen  (model routing table, validators, policies → Y/n)
    ↓
Workflow Orchestrator  (src/core/orchestrator/)
    ↓
State Machine  (10 nodes, parallel execution)
    ↓
Agent Router  (every role independently configurable)
    ├── Research Agent    → any provider (default: Claude)
    ├── Planner Agent     → any provider (outputs dependency graph)
    ├── Code Agent        → any provider (runs in parallel waves)
    ├── Repair Agent      → any provider (gets attempt counts + history)
    ├── Visual Review     → any provider (reviews screenshots)
    └── Post-Approval     → any provider (regression scan)
    ↓
Tool Layer
    ├── Shell runner
    ├── Git (diff, worktree, checkpoints)
    ├── Package manager (build, lint, typecheck, tests)
    └── Playwright (E2E + screenshot capture)
    ↓
Validation Engine
    ├── Deterministic: build / lint / typecheck / tests
    │   └── Per-validator issues (not aggregated)
    └── Visual: screenshots + AI review
    ↓
Repair Loop
    ├── Per-issue retry budgets (3 per issue, 6 per run)
    ├── Issue resolution on pass
    ├── Progress tracking (regression detection)
    ├── Auto-replan at 50% budget
    └── Human escalation with full context
    ↓
Promote → DONE
```

### Run folder — what gets written

Every run creates a self-contained folder inside your project:

```
.maiker/runs/<run-id>/
├── job.json             ← what was requested
├── state.json           ← current run state (live updated)
├── plan.md              ← human-readable execution plan
├── classification.json  ← detected task type and risk
├── artifacts/
│   ├── screenshots/     ← Playwright screenshots at each viewport
│   ├── traces/          ← Playwright trace files
│   ├── logs/
│   │   └── events.jsonl ← every event as structured JSON
│   ├── diffs/           ← git diffs from each stage
│   └── reports/         ← validation reports
├── issues/
│   ├── open.json        ← issues still being worked
│   ├── resolved.json    ← fixed issues (moved here when validator passes)
│   └── escalated.json   ← issues sent to human review
├── review/
│   ├── human-review.md  ← written when escalation triggers
│   └── post-approval-review.md
└── final/
    ├── summary.md       ← final readable summary (includes subtask + changed file list)
    ├── scorecard.json
    └── outcome.json
```

---

## Project Structure

```
maiker/
├── bin/
│   └── maiker.ts              # CLI binary entry point
├── src/
│   ├── cli/
│   │   ├── index.ts           # Commander.js setup
│   │   ├── preflight.ts       # Pre-flight confirmation screen
│   │   ├── commands/          # init, run, validate, repair, status, logs...
│   │   └── output/            # terminal rendering, tables, event display
│   ├── core/
│   │   ├── orchestrator/      # Workflow state machine (parallel execution, 10 nodes)
│   │   ├── state/             # Run folder management, state reads/writes, issue tracking
│   │   ├── router/            # Maps agent roles to model configs
│   │   ├── classification/    # Repo inspector + task classifier
│   │   └── policies/          # Retry limits, validation profiles, auto-replan, impact analysis
│   ├── agents/
│   │   ├── research/          # Research agent
│   │   ├── planner/           # Planner agent (outputs dependency graph)
│   │   ├── coder/             # Code agent (receives shared context)
│   │   ├── repair/            # Repair agent (receives attempt counts + history)
│   │   ├── visual/            # Visual review agent
│   │   ├── review/            # Post-approval review agent
│   │   └── shared/            # Provider dispatcher (routes to Claude/OpenAI/Gemini/etc.)
│   ├── providers/
│   │   ├── claude/            # Anthropic SDK
│   │   ├── openai/            # OpenAI SDK
│   │   ├── gemini/            # Google Gemini
│   │   └── pi-mono/           # pi-mono (internal routing)
│   ├── tools/
│   │   ├── shell/             # execFile / spawn wrappers
│   │   ├── git/               # status, diff, worktree, checkpoints, rollback
│   │   ├── filesystem/        # glob, read, summarise
│   │   ├── package/           # build, lint, typecheck, test runners
│   │   ├── playwright/        # E2E runner + screenshot capture
│   │   └── diff/              # git diff summary
│   ├── validators/
│   │   ├── engine/            # Orchestrates deterministic + visual
│   │   ├── deterministic/     # build / lint / typecheck / tests
│   │   ├── visual/            # Playwright + AI visual review
│   │   └── contracts/         # Zod schemas for issues and state
│   ├── artifacts/             # Event bus, JSONL log, artifact save helpers
│   ├── config/                # YAML config loader with defaults
│   └── types/                 # All shared TypeScript types
├── templates/
│   ├── maiker.config.yaml     # Default config template
│   ├── prompts/               # Agent system prompts
│   ├── policies/              # Policy templates
│   └── reports/               # Report templates
├── scripts/
│   ├── bootstrap.sh           # install + build + link in one command
│   ├── install-playwright.sh  # Installs Playwright browser binaries
│   └── check-env.sh           # Validates your environment is ready
└── examples/                  # Usage examples
```

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make changes following existing TypeScript patterns
4. Confirm types are clean: `npm run typecheck`
5. Submit a pull request

### Dev mode (no build step)

```bash
# Run any command without rebuilding
npx tsx bin/maiker.ts inspect .
npx tsx bin/maiker.ts run ./app --goal "..."
```

### Rebuild after changes

```bash
npm run build
# The global maiker command now uses the updated build
```

### Adding a new provider

1. Create `src/providers/<name>/index.ts` with a `callProvider(model, system, user)` function
2. Register it in `src/agents/shared/base.ts` dispatch map
3. Use the provider name in `maiker.config.yaml` for any role

### Adding a new agent

1. Add input/output types to `src/types/index.ts`
2. Create `src/agents/<name>/index.ts` — include system prompt and handler function
3. Add model config to defaults in `src/config/index.ts`
4. Add a node in `src/core/orchestrator/index.ts` and wire the edges

### Adding a new validator

1. Add the name to `ValidatorName` in `src/types/index.ts`
2. Implement the runner in `src/validators/deterministic/index.ts`
3. Add to relevant profiles in `src/core/policies/index.ts`
4. Add the config flag in `src/config/index.ts` defaults

---

## License

MIT — see [LICENSE](./LICENSE)

---

_Built with [Claude Code](https://claude.ai/claude-code) · Powered by Anthropic, Playwright, and LangGraph_

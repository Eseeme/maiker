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
[maiker repo]  →  one command  →  maiker available globally
      ↓
[your project]  →  maiker init (interactive model setup)  →  maiker run . --goal "..."
```

---

## Part 1 — Install mAIker (one command)

Do this **once**, inside the `maiker` repository folder (the folder you cloned).

**Requires:** Node.js 18+ ([nodejs.org](https://nodejs.org))

### One command (recommended)

```bash
sudo ./scripts/bootstrap.sh
```

This does everything:
- Checks Node version
- Fixes any file permission issues from previous installs
- Installs dependencies (as your user, not root)
- Builds TypeScript (as your user, not root)
- Links the `maiker` command globally (needs sudo)
- Sets correct permissions on the global binary
- Detects available authentication (Claude Code OAuth, API keys)

> **Why sudo?** The `npm link` step installs a global binary in `/usr/local/bin/`, which requires root. The bootstrap runs `npm install` and `npm run build` as your real user to avoid permission issues.

### Manual steps (alternative)

```bash
npm install                # install dependencies
npm run build              # compile TypeScript
sudo npm link              # register maiker command globally
sudo chmod +x /usr/local/bin/maiker  # ensure binary is executable
```

### Verify it works

```bash
maiker --help
```

### Optional — Playwright browsers (for E2E + screenshots)

```bash
./scripts/install-playwright.sh
```

---

## Part 2 — Authentication

mAIker needs API keys to call AI models. You need **at least one** provider.

### Option A — Claude Code (easiest, no .env needed)

If you use [Claude Code](https://claude.ai/claude-code), mAIker **automatically detects** your OAuth token from `~/.claude/.credentials.json`. No `.env` file needed for Anthropic.

```bash
# Just make sure you're logged in:
claude auth login
# That's it — mAIker picks up the token automatically
```

The token refreshes automatically. mAIker always reads the latest token at startup, and prefers a fresh OAuth token over a stale one from `.env`.

### Option B — API keys in .env

Create a `.env` file in your **project folder** (where you run `maiker init`):

```bash
ANTHROPIC_API_KEY=sk-ant-api03-...    # Claude (code, repair, review)
OPENAI_API_KEY=sk-proj-...            # GPT-4o, o3, Codex (planning, vision)
GOOGLE_API_KEY=AIza...                # Gemini (research, large context)
```

**You don't need all three.** Even a single key works — `maiker init` will detect which keys you have and pick the best model for each role automatically.

### Provider summary

| Provider | Env Variable | Auto-detect | How to get |
|----------|-------------|-------------|------------|
| Claude | `ANTHROPIC_API_KEY` | From Claude Code OAuth | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) |
| OpenAI | `OPENAI_API_KEY` | .env only | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| Gemini | `GOOGLE_API_KEY` | .env only | [aistudio.google.dev/apikey](https://aistudio.google.dev/apikey) |

---

## Part 3 — Point mAIker at your project

Open a terminal **inside your actual project** (not the maiker repo).

```bash
cd /path/to/your-app
maiker init
```

### What `maiker init` does (interactive)

1. **Detects your API keys** — scans environment for `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`
2. **Validates keys work** — makes a test call to each provider
3. **Recommends the best model for each role** based on what's available:

```
  Detected API keys:

    claude     ANTHROPIC_API_KEY        ✓ found
    openai     OPENAI_API_KEY           ✓ found
    gemini     GOOGLE_API_KEY           ✗ not set

  Recommended model routing:

    Research ingestion       claude  claude-sonnet-4-6       (reasoning, code, analysis)
    Planner                  openai  o3                      (reasoning, planning)
    Code generation          claude  claude-sonnet-4-6       (code, analysis)
    Repair                   claude  claude-sonnet-4-6       (code, repair)
    Visual review            openai  gpt-4o                  (vision)
    Post-approval review     claude  claude-haiku-4-5        (fast, cheap, review)

  Use these models? [Y/n]
```

4. **Writes `maiker.config.yaml`** with the selected models
5. **Creates `.maiker/` folder** for run outputs

The recommendation engine scores every model against each role's needs:

| Role | What it needs | Best fit examples |
|------|--------------|-------------------|
| Research | Large context, reasoning | Gemini 2.5 Pro (1M ctx), Claude Opus |
| Planner | Reasoning, planning | o3, Claude Opus |
| Code generation | Code quality | Claude Sonnet, Codex Mini |
| Repair | Code + analysis | Claude Sonnet |
| Visual review | Multimodal/vision | GPT-4o, Claude Sonnet |
| Post-approval | Fast review (cost-sensitive) | Claude Haiku, GPT-4o Mini |

You can always change models later in `maiker.config.yaml`. Skip interactive setup with `maiker init --skip-setup`.

### After init

```
your-app/
├── maiker.config.yaml    ← created by maiker init (with your model choices)
├── .maiker/              ← created by maiker init
│   ├── runs/             ← run outputs will go here
│   └── checkpoints.db    ← LangGraph durable checkpoints (SqliteSaver)
├── src/
├── package.json
└── ...your files...
```

### Inspect your project (optional but recommended)

```bash
maiker inspect .
```

Scans your project and shows what mAIker detected: framework, package manager, routes, test setup.

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

Open that file, read the summary, then resume with a decision:

```bash
maiker resume --run-id <the-run-id-shown>                    # interactive prompt
maiker resume --run-id <the-run-id-shown> --decision proceed # continue from where it stopped
maiker resume --run-id <the-run-id-shown> --decision replan  # go back to PLAN stage
maiker resume --run-id <the-run-id-shown> --decision abort   # stop the run
```

---

## Pre-flight Confirmation

Before every run, mAIker shows a **pre-flight screen** that validates your setup and shows exactly which models will be used:

```
  Pre-flight check
  ────────────────────────────────────────

  Run ID:   mk-2026-03-09_12-24-00-90fe8341
  Project:  /home/you/projects/my-app
  Goal:     Make the dashboard mobile responsive

  Agent Model Routing

  Research ingestion     claude  claude-sonnet-4-6       (reasoning, code, analysis)
  Planner                openai  o3                      (reasoning, planning)
  Code generation        claude  claude-sonnet-4-6       (code, analysis)
  Repair                 claude  claude-sonnet-4-6       (code, repair)
  Visual review          openai  gpt-4o                  (vision)
  Post-approval review   claude  claude-haiku-4-5        (fast, cheap, review)

  Validators

  install  build  lint  typecheck  unit_tests  playwright_e2e
  screenshot_capture  visual_review  ux_rules
  skipped: integration_tests, accessibility, lockfile_sanity

  Policies

  Max repairs / issue:  3
  Max repairs / run:    6
  Auto-replan at:       50% budget exhausted
  Human approval:       required
  Post-approval review: enabled

  Proceed with these settings? [Y/n/e]
```

- **Y** (or Enter) — proceed with the run
- **n** — opens a menu: edit config and retry, switch to dry-run, or quit
- **e** — pause to edit `maiker.config.yaml`, then press Enter to re-check

### Key validation

If a configured provider is missing its API key, pre-flight **blocks the run** and suggests alternatives:

```
  ⚠ Missing API keys

    ✗ gemini: GOOGLE_API_KEY not set
      Affects: Research ingestion

  Suggested fix: switch missing roles to available providers:

    Research ingestion       → claude  claude-sonnet-4-6  (reasoning, code, analysis)

  Edit maiker.config.yaml to apply, or add the missing keys to .env

  Cannot proceed: missing API keys for configured providers.
```

In CI/non-TTY environments, defaults to yes (but still blocks on missing keys).

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

mAIker analyses the impact and decides what to do based on the **impact level**:

| Impact | Action | When |
|--------|--------|------|
| `low` | `continue` — no change to the running workflow | Minor clarifications, style preferences |
| `medium` | `rerun_current_stage` — reruns the stage in progress | New constraints that affect current work |
| `high` | `replan_downstream` — goes back to PLAN and replans remaining work | Fundamental changes to requirements |

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
| `maiker run <path> --goal "..." --dry-run` | Plans only — generates plan then stops (no code changes) |
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
| `maiker artifacts list --category <name>` | Filter by category: screenshots, traces, logs, diffs, reports |

### Control

| Command | What it does |
|---------|-------------|
| `maiker pause` | Pauses the current run at the next safe checkpoint |
| `maiker pause --run-id <id>` | Pauses a specific run |
| `maiker resume` | Resumes the most recently paused/blocked run |
| `maiker resume --run-id <id>` | Resumes a specific run |
| `maiker resume --decision <d>` | Resume with decision: `proceed`, `replan`, or `abort` |
| `maiker context add --message "..."` | Injects a constraint or update into the running workflow |
| `maiker context show` | Shows all context updates injected into the current run |

### Key flags

```bash
--goal "<text>"     # What you want mAIker to do (required for run and plan)
--run-id <id>       # Target a specific run by ID
--config <path>     # Use a specific config file instead of maiker.config.yaml
--verbose           # Show every event in detail
--dry-run           # Plan only, make no code changes (stops after PLAN stage)
--from-last-run     # Resume from the last run
--yes               # Skip the pre-flight confirmation prompt
--follow            # Tail log output live
--raw               # Output as raw JSON events (logs command)
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
# Auto-configured by: maiker init (based on your available API keys)
# Each role is independently swappable — change provider + model for any role.
# Built-in providers: claude | openai | gemini | pi-mono
# Re-run: maiker init --force to re-detect keys and get new recommendations.
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
  require_human_approval: true          # pause for human go-ahead before promoting (uses interrupt())
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

### How models are selected

When you run `maiker init`, the recommendation engine scores every known model against each role's requirements:

| Role | Needs | Best picks |
|------|-------|-----------|
| Research ingestion | Large context window, reasoning | Gemini 2.5 Pro (1M tokens), Claude Opus |
| Planner | Strong reasoning, planning | o3, Claude Opus |
| Code generation | Code quality, repair capability | Claude Sonnet, Codex Mini |
| Repair agent | Code + analysis, targeted diffs | Claude Sonnet |
| Visual review | Multimodal/vision (screenshots) | GPT-4o (vision), Claude Sonnet |
| Post-approval review | Fast, cheap review | Claude Haiku, GPT-4o Mini |

The engine considers: strength match, multimodal capability, cost tier, and context window size. It only recommends models from providers you have API keys for.

### Fallback behaviour

- **Only Claude key** → all roles use Claude (Sonnet for most, Haiku for review)
- **Claude + OpenAI** → Claude for code/repair, OpenAI for planning (o3) and vision (GPT-4o)
- **All three keys** → Gemini for research (1M context), OpenAI for planning/vision, Claude for code/repair

### Known models

| Provider | Models | Strengths |
|----------|--------|-----------|
| `claude` | claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5 | Code, reasoning, analysis |
| `openai` | o3, gpt-4o, gpt-4o-mini, codex-mini | Planning, vision, code |
| `gemini` | gemini-2.5-pro, gemini-2.5-flash | Large context (1M), research |

**Built-in providers:** `claude`, `openai`, `gemini`, `pi-mono`

You can add your own provider adapter in `src/providers/` and use any provider name in config.

---

## Workflow Stages

```
INIT → INSPECT → CLASSIFY → PLAN → EXECUTE (parallel subtasks)
  └─ EXECUTE → VALIDATE_DETERMINISTIC
       ├─ pass → resolve issues → VALIDATE_VISUAL
       │    ├─ pass → POST_APPROVAL_REVIEW (human approval gate) → PROMOTE → DONE
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
| **HUMAN_ESCALATION** | Uses LangGraph `interrupt()` to pause graph. Writes escalation packet. Resume with `maiker resume --decision proceed\|replan\|abort` |
| **POST_APPROVAL_REVIEW** | If `require_human_approval: true`, pauses for human go-ahead (uses `interrupt()`). Then scans for hidden regressions and scope drift. |
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

> **Note:** `accessibility` and `mobile_layout_rules` are declared in the type system but **not yet implemented**. Enabling them in config will result in a skip. Contributions welcome.

---

## Architecture Overview

```
User / Developer
    ↓
mAIker CLI  (commander.js)
    ↓
Pre-flight Screen  (key validation, model routing table → Y/n)
    ↓
LangGraph StateGraph  (src/core/orchestrator/)
    │
    ├── Annotation      — typed state with reducers for parallel merging
    ├── Conditional edges — route between nodes based on stage
    ├── SqliteSaver     — durable checkpointing for pause/resume (persists across restarts)
    ├── interrupt()     — human-in-the-loop escalation
    └── RetryPolicy     — automatic retry with backoff on LLM-calling nodes
    │
    ↓  10 nodes, parallel subtask execution
Agent Router  (auto-selected per role based on available API keys)
    ├── Research Agent    → any provider (scored: large-context, reasoning)
    ├── Planner Agent     → any provider (scored: reasoning, planning)
    ├── Code Agent        → any provider (parallel waves via Promise.allSettled)
    ├── Repair Agent      → any provider (gets attempt counts + history)
    ├── Visual Review     → any provider (scored: multimodal/vision)
    └── Post-Approval     → any provider (scored: fast, cheap)
    ↓
Error Classification  (src/types/ — classifyError())
    ├── transient (rate limit, timeout)  → auto-retry with backoff
    ├── auth (invalid key, 401)          → escalate immediately
    ├── validation (build/lint/test)     → repair loop
    ├── resource (OOM, disk full)        → escalate
    ├── dependency (missing module)      → targeted fix
    └── code_generation (parse error)    → retry
    ↓
Tool Layer
    ├── Shell runner
    ├── Git (diff, worktree, checkpoints, rollback)
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
    └── Human escalation via LangGraph interrupt()
    ↓
Promote → DONE
```

### Why LangGraph

The orchestrator uses [LangGraph.js](https://github.com/langchain-ai/langgraphjs) (`@langchain/langgraph`) as the workflow engine:

| LangGraph feature | What we use it for |
|-------------------|-------------------|
| `StateGraph` | Defines the 10-node workflow graph with typed state |
| `Annotation` with reducers | Allows parallel nodes to write to shared state safely (e.g. `subtaskStates` merges results from concurrent agents) |
| `Conditional edges` | Routes between nodes based on validation results, escalation thresholds, and stage transitions |
| `SqliteSaver` | Durably checkpoints graph state to `.maiker/checkpoints.db` so runs survive process restarts and can be paused/resumed from any point |
| `interrupt()` + `Command` | Pauses the graph at human escalation; resumes with `new Command({ resume: decision })` when the user runs `maiker resume --decision replan` |
| `RetryPolicy` | Automatic retry with exponential backoff and jitter on LLM-calling nodes (plan, execute, repair, post-approval review) |

We use LangGraph for the **graph structure, state management, and checkpointing**. The actual AI calls go through our own provider adapters (not LangChain's LLM classes), keeping model routing independent and swappable.

### Resilience features

| Feature | What it does |
|---------|-------------|
| **Error classification** | `classifyError()` in `src/types/` categorises errors (transient, auth, validation, resource, dependency, code_generation) and routes each to the right recovery strategy (retry, repair, escalate, replan) |
| **State mutex** | In-process per-runId lock prevents race conditions when parallel subtasks (`Promise.allSettled`) write to `state.json` concurrently |
| **Non-Claude file writing** | Code and repair agents extract `files: [{path, content}]` from non-Claude provider responses and write them to disk, so OpenAI/Gemini agents can modify files without tool-use |
| **Durable checkpoints** | `SqliteSaver` persists to `.maiker/checkpoints.db` instead of in-memory, so runs survive crashes and restarts |
| **Word-boundary context matching** | Context impact analysis uses regex word boundaries (`\bdo not\b`) instead of substring matching, preventing false triggers on words like "also" appearing inside other words |

### Detailed Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              USER / DEVELOPER                                │
│                                                                              │
│   maiker init          maiker run . --goal "..."       maiker resume         │
│   maiker inspect .     maiker validate .               maiker context add    │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                           CLI LAYER  (Commander.js)                           │
│                                                                              │
│   src/cli/commands/     src/cli/preflight.ts     src/cli/output/             │
│   ├── init.ts           ├── Key validation       ├── Terminal tables          │
│   ├── run.ts            ├── Model routing table   ├── Spinner + progress     │
│   ├── resume.ts         └── Y/n/e confirmation    └── Event display          │
│   ├── status.ts                                                              │
│   ├── logs.ts                                                                │
│   └── context.ts                                                             │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                    ORCHESTRATOR  (LangGraph StateGraph)                       │
│                    src/core/orchestrator/index.ts                             │
│                                                                              │
│   ┌─────────┐    ┌─────────┐    ┌──────────┐    ┌────────┐    ┌─────────┐  │
│   │  INIT   │───▶│ INSPECT │───▶│ CLASSIFY │───▶│  PLAN  │───▶│ EXECUTE │  │
│   └─────────┘    └─────────┘    └──────────┘    └────────┘    └────┬────┘  │
│                                                  ▲  ▲              │        │
│                                    auto-replan ──┘  │              ▼        │
│                                                     │    ┌────────────────┐ │
│                                                     │    │   VALIDATE     │ │
│                                                     │    │ DETERMINISTIC  │ │
│                                                     │    └───┬────────┬───┘ │
│                                                     │   pass │        │fail │
│                                                     │        ▼        ▼     │
│   ┌──────────┐    ┌──────────┐    ┌─────────┐    ┌──────┐  ┌──────────┐   │
│   │   DONE   │◀───│ PROMOTE  │◀───│POST_APPR│◀───│VISUAL│  │  REPAIR  │   │
│   └──────────┘    └──────────┘    │  REVIEW  │    │VALID │  └────┬─────┘   │
│                                   └──────────┘    └──────┘       │         │
│   ┌──────────┐    ┌──────────┐                           ┌───────┘         │
│   │  FAILED  │    │ BLOCKED  │◀── HUMAN_ESCALATION ◀─────┘ budget          │
│   └──────────┘    └──────────┘    (interrupt())        exhausted            │
│                                                                              │
│   Persistence: SqliteSaver → .maiker/checkpoints.db                         │
│   Retry: RetryPolicy { maxAttempts: 3, backoff: 2x, jitter: true }         │
│   Resume: Command({ resume: 'proceed' | 'replan' | 'abort' })              │
│   State mutex: per-runId lock for parallel safety                            │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                           AGENT LAYER                                        │
│                                                                              │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│   │   Research    │  │   Planner    │  │    Coder     │  │   Repair     │   │
│   │   Agent       │  │   Agent      │  │   Agent      │  │   Agent      │   │
│   │              │  │              │  │              │  │              │   │
│   │ Large ctx,   │  │ Reasoning,   │  │ Code quality │  │ Attempt #,   │   │
│   │ analysis     │  │ dep graph    │  │ parallel     │  │ history,     │   │
│   │              │  │              │  │ waves        │  │ diff strategy│   │
│   └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │
│          │                 │                 │                 │            │
│   ┌──────────────┐  ┌──────────────┐                                       │
│   │Visual Review │  │ Post-Approval│    src/agents/shared/                  │
│   │   Agent      │  │   Review     │    ├── base.ts      (provider router)  │
│   │              │  │              │    ├── tool-loop.ts  (multi-turn loop)  │
│   │ Multimodal,  │  │ Fast, cheap, │    └── tools.ts     (read/write/run)   │
│   │ screenshots  │  │ regression   │                                        │
│   └──────┬───────┘  └──────┬───────┘                                       │
│          │                 │                                                │
└──────────┼─────────────────┼────────────────────────────────────────────────┘
           │                 │
           ▼                 ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                        PROVIDER LAYER                                        │
│                                                                              │
│   ┌────────────┐   ┌────────────┐   ┌────────────┐   ┌────────────┐        │
│   │  Claude     │   │  OpenAI    │   │  Gemini    │   │  pi-mono   │        │
│   │ (Anthropic) │   │            │   │ (Google)   │   │ (internal) │        │
│   │             │   │            │   │            │   │            │        │
│   │ Tool-use    │   │ Tool-use   │   │ Tool-use   │   │            │        │
│   │ native      │   │ + file     │   │ + file     │   │            │        │
│   │             │   │ extraction │   │ extraction │   │            │        │
│   └─────────────┘   └────────────┘   └────────────┘   └────────────┘        │
│                                                                              │
│   Error Classification: classifyError()                                      │
│   transient → retry │ auth → escalate │ validation → repair │ resource → esc│
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                          TOOL LAYER                                          │
│                                                                              │
│   Shell runner          Git                   Package manager                │
│   ├── execFile          ├── status, diff      ├── build                     │
│   └── spawn             ├── worktree          ├── lint, typecheck           │
│                         ├── checkpoints       ├── unit tests                │
│   Filesystem            └── rollback          └── integration tests         │
│   ├── glob, read                                                            │
│   └── summariseRepo     Playwright                                          │
│       (cached)          ├── E2E runner                                      │
│                         └── screenshot capture                              │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                       VALIDATION ENGINE                                      │
│                                                                              │
│   Deterministic                          Visual                              │
│   ├── install    ─┐                      ├── screenshot_capture              │
│   ├── build       │                      ├── visual_review (AI)              │
│   ├── lint        ├─▶ per-validator      ├── ux_rules                       │
│   ├── typecheck   │   issues (not        ├── accessibility                  │
│   ├── unit_tests  │   aggregated)        └── mobile_layout_rules            │
│   └── e2e tests  ─┘                                                         │
│                                                                              │
│   Profiles: auto-selected by task type (mobile-redesign, feature, bugfix..) │
└──────────────────────────────────────────────────────────────────────────────┘
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
│   │   ├── orchestrator/      # LangGraph StateGraph (10 nodes, conditional edges, checkpointing)
│   │   ├── state/             # Run folder management, state reads/writes, issue tracking
│   │   ├── router/            # Maps agent roles to model configs
│   │   ├── models/            # Model registry, scoring engine, key detection, recommendations
│   │   ├── classification/    # Repo inspector + task classifier
│   │   └── policies/          # Retry limits, validation profiles, auto-replan, impact analysis
│   ├── agents/
│   │   ├── research/          # Research agent
│   │   ├── planner/           # Planner agent (outputs dependency graph)
│   │   ├── coder/             # Code agent (receives shared context)
│   │   ├── repair/            # Repair agent (receives attempt counts + history)
│   │   ├── visual/            # Visual review agent
│   │   ├── review/            # Post-approval review agent
│   │   └── shared/
│   │       ├── base.ts        # Provider dispatcher (routes to Claude/OpenAI/Gemini)
│   │       ├── tool-loop.ts   # LLM ↔ tool-use cycle (multi-turn agent loop)
│   │       └── tools.ts       # Tool definitions + disk execution (read/write/list/run)
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
# The global maiker command now uses the updated build (it's symlinked)

# Or rebuild + re-link everything:
sudo ./scripts/bootstrap.sh
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

_Built with [Claude Code](https://claude.ai/claude-code) · Powered by Anthropic, OpenAI, Gemini, and Playwright_

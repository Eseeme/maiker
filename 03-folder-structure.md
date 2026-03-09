# Folder Structure

## Repo layout

```text
maiker-cli/
├── README.md
├── package.json
├── tsconfig.json
├── .env.example
├── bin/
│   └── maiker.ts
├── src/
│   ├── cli/
│   │   ├── index.ts
│   │   ├── commands/
│   │   │   ├── init.ts
│   │   │   ├── configure.ts
│   │   │   ├── inspect.ts
│   │   │   ├── plan.ts
│   │   │   ├── run.ts
│   │   │   ├── validate.ts
│   │   │   ├── repair.ts
│   │   │   ├── review.ts
│   │   │   ├── status.ts
│   │   │   ├── logs.ts
│   │   │   ├── pause.ts
│   │   │   ├── resume.ts
│   │   │   └── context.ts
│   │   └── output/
│   ├── core/
│   │   ├── orchestrator/
│   │   ├── state/
│   │   ├── router/
│   │   ├── classification/
│   │   └── policies/
│   ├── agents/
│   │   ├── research/
│   │   ├── planner/
│   │   ├── coder/
│   │   ├── repair/
│   │   ├── visual/
│   │   ├── review/
│   │   └── shared/
│   ├── providers/
│   │   ├── claude/
│   │   ├── gemini/
│   │   ├── openai/
│   │   └── pi-mono/
│   ├── tools/
│   │   ├── shell/
│   │   ├── git/
│   │   ├── filesystem/
│   │   ├── package/
│   │   ├── testing/
│   │   ├── playwright/
│   │   └── diff/
│   ├── validators/
│   │   ├── engine/
│   │   ├── deterministic/
│   │   ├── visual/
│   │   └── contracts/
│   ├── artifacts/
│   ├── config/
│   └── types/
├── templates/
│   ├── maiker.config.yaml
│   ├── prompts/
│   ├── policies/
│   └── reports/
├── scripts/
│   ├── bootstrap.sh
│   ├── install-playwright.sh
│   └── check-env.sh
└── examples/
```

## Run folder layout

```text
.maiker/
└── runs/
    └── 2026-03-08_18-40-12/
        ├── job.json
        ├── state.json
        ├── plan.md
        ├── classification.json
        ├── artifacts/
        │   ├── screenshots/
        │   ├── traces/
        │   ├── logs/
        │   ├── diffs/
        │   └── reports/
        ├── issues/
        │   ├── open.json
        │   ├── resolved.json
        │   └── escalated.json
        ├── review/
        │   ├── human-review.md
        │   └── post-approval-review.md
        └── final/
            ├── summary.md
            ├── scorecard.json
            └── outcome.json
```

## Folder design rules

1. Every run must be isolated.
2. Every issue must be persisted as structured data.
3. Artifacts must be addressable by path.
4. Stage output must be resumable.
5. Context changes must be appended, not overwritten.

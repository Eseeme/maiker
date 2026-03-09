# mAIker Examples

This directory contains example projects and usage scenarios.

## Example 1 — Responsive Redesign

```bash
# Given an existing Next.js app at ./my-nextjs-app:
maiker run ./my-nextjs-app \
  --goal "Make the dashboard mobile responsive without breaking desktop layout"
```

What mAIker will do:
1. Inspect the repo (Next.js, TypeScript, Playwright detected)
2. Classify: mobile-responsive-redesign, medium risk
3. Plan: 3 subtasks covering layout, navigation, tables
4. Execute: Code agent applies CSS/component changes
5. Validate: build, lint, typecheck, Playwright E2E, screenshot capture
6. Visual review: AI reviews screenshots at 375px, 390px, 768px
7. Repair: Fix bottom-nav and CTA overflow issues (max 3 attempts)
8. Post-approval review: Detect scope drift
9. Package: Final report in .maiker/runs/<id>/final/

## Example 2 — Framework Upgrade

```bash
maiker run ./my-app \
  --goal "Upgrade Next.js from 14 to 15 and verify no regressions"
```

Validators activated: install, build, lint, typecheck, unit_tests, playwright_e2e

## Example 3 — Targeted Bugfix

```bash
maiker run ./my-app \
  --goal "Fix CTA button overflow on mobile viewports below 390px"
```

Validators activated: build, lint, typecheck (minimal profile, fast iteration)

## Example 4 — Inject context mid-run

```bash
# Start a run
maiker run ./my-app --goal "Redesign the nav component" &

# Later, add a constraint
maiker context add --message "Do not change the desktop navigation order"
```

## Example 5 — Validate only

```bash
maiker validate ./my-app
```

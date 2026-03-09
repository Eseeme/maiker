# Validation Profiles

## Principle

Validation must be **dynamic**.

It should depend on:
- project type
- task type
- risk level
- policy
- available tooling

## Validator categories

### Core validators
Usually enabled:
- install
- build
- lint
- typecheck

### Behavioral validators
Enabled for flows and user actions:
- unit tests
- integration tests
- Playwright E2E

### Visual validators
Enabled for UI/UX work:
- screenshots
- viewport matrix
- layout review
- UX rule review

### Upgrade validators
Enabled for dependency/framework changes:
- install
- lockfile sanity
- build
- regression tests
- compatibility checks

## Example profile: mobile responsive redesign

```yaml
validation_profile:
  task_type: mobile-responsive-redesign
  required:
    - build
    - lint
    - typecheck
    - playwright_e2e
    - screenshot_capture
    - visual_review
    - ux_rules
  optional:
    - accessibility
  skipped:
    - db_migration_validation
```

## Example profile: framework upgrade

```yaml
validation_profile:
  task_type: framework-upgrade
  required:
    - install
    - build
    - lint
    - typecheck
    - unit_tests
    - integration_tests
    - playwright_e2e
  optional:
    - screenshot_capture
    - visual_review
  skipped:
    - mobile_layout_rules
```

## AI's role in validation

AI should **not replace deterministic testing**.

Correct sequence:
1. deterministic validators produce evidence
2. AI reviews evidence against task constraints
3. AI emits structured findings
4. repair loop acts on structured issues

## Structured issue example

```json
{
  "id": "layout-004",
  "category": "layout",
  "severity": "high",
  "stage": "validate_visual",
  "page": "/dashboard",
  "viewport": "390x844",
  "selector": "[data-testid='bottom-nav']",
  "observed": "Navigation only appears after full-page scroll.",
  "expected": "Primary navigation should remain reachable without full-page scroll.",
  "repairHint": "Use sticky or fixed navigation with safe-area support.",
  "status": "open"
}
```

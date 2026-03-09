# Config Schema

## Example file

See `maiker.config.example.yaml`.

## Top-level sections

### `project`
Basic repo settings:
- name
- root
- framework
- package_manager

### `models`
Maps stage to provider/model.

### `validators`
Enables or disables validator families.

### `playwright`
Controls base URL, viewports, routes.

### `policies`
Controls retries, approval, escalation.

### `artifacts`
Controls run output paths and artifact retention.

## Design rules

1. User should be able to override by stage.
2. Defaults should be safe.
3. Task-specific validation profile should extend, not fight, base config.
4. Runtime policy should be visible in logs and reports.

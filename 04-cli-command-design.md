# CLI Command Design

## Main commands

```bash
maiker init
maiker configure
maiker inspect <path>
maiker plan <path>
maiker run <path>
maiker validate <path>
maiker repair <path>
maiker review <path>
maiker status
maiker logs --follow
maiker pause --run-id <id>
maiker resume --run-id <id>
maiker context add --run-id <id> --message "<text>"
maiker context show --run-id <id>
maiker artifacts list --run-id <id>
```

## Command descriptions

### `maiker init`
Bootstraps local dependencies and `.maiker/`.

### `maiker configure`
Creates or edits `maiker.config.yaml`.

### `maiker inspect <path>`
Scans repo and detects:
- framework
- package manager
- routes/apps
- test setup
- likely task hotspots

### `maiker plan <path>`
Produces:
- classification
- validation profile
- subtask plan
- acceptance criteria

### `maiker run <path>`
Full workflow:
- inspect
- classify
- plan
- implement
- validate
- repair
- escalate
- package result

### `maiker validate <path>`
Runs validators only.

### `maiker repair <path>`
Uses existing issue files to apply minimal fixes.

### `maiker review <path>`
Runs post-approval review only.

### `maiker status`
Shows latest or selected run status.

### `maiker logs --follow`
Streams live execution events and tool output.

### `maiker pause` / `resume`
Pauses or resumes a workflow.

### `maiker context add`
Adds in-flight instructions with impact analysis.

## Suggested flags

```bash
--goal "<text>"
--config ./maiker.config.yaml
--run-id <id>
--from-last-run
--stage <name>
--subtask <id>
--max-retries <n>
--verbose
--dry-run
--ui
```

## Example sessions

### Responsive redesign
```bash
maiker run ./app --goal "Make dashboard mobile responsive without breaking desktop"
```

### Version upgrade
```bash
maiker run ./app --goal "Upgrade Next.js version and validate no regressions"
```

### Add context during run
```bash
maiker context add --run-id mk-001 --message "Do not modify desktop navigation"
```

### Watch logs
```bash
maiker logs --follow --run-id mk-001
```

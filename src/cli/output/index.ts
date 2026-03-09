import chalk from 'chalk';
import type { RunState, MaikerEvent, Issue, ValidatorResult } from '../../types/index.js';

// ─── Symbols ──────────────────────────────────────────────────────────────────

export const sym = {
  check: chalk.green('✓'),
  cross: chalk.red('✗'),
  warn: chalk.yellow('⚠'),
  info: chalk.blue('ℹ'),
  arrow: chalk.cyan('→'),
  bullet: chalk.gray('·'),
  run: chalk.magenta('►'),
  pause: chalk.yellow('⏸'),
  repair: chalk.yellow('⟳'),
};

// ─── Banners ──────────────────────────────────────────────────────────────────

export function banner(): void {
  console.log('');
  console.log(chalk.bold.cyan('  mAIker') + chalk.gray(' — AI-powered product engineering CLI'));
  console.log(chalk.gray('  ─────────────────────────────────────'));
  console.log('');
}

export function success(msg: string): void {
  console.log(`  ${sym.check} ${msg}`);
}

export function fail(msg: string): void {
  console.log(`  ${sym.cross} ${chalk.red(msg)}`);
}

export function warn(msg: string): void {
  console.log(`  ${sym.warn} ${chalk.yellow(msg)}`);
}

export function info(msg: string): void {
  console.log(`  ${sym.info} ${chalk.blue(msg)}`);
}

export function log(msg: string): void {
  console.log(`  ${sym.bullet} ${chalk.gray(msg)}`);
}

export function section(title: string): void {
  console.log('');
  console.log(chalk.bold(`  ${title}`));
  console.log(chalk.gray('  ' + '─'.repeat(Math.max(0, title.length))));
}

// ─── Run Status Display ───────────────────────────────────────────────────────

export function renderRunStatus(state: RunState): void {
  type ChalkFn = (text: string) => string;
  const statusColor: Record<string, ChalkFn> = {
    running: chalk.green,
    paused: chalk.yellow,
    done: chalk.cyan,
    failed: chalk.red,
    blocked: chalk.red,
    pending: chalk.gray,
  };

  const colour = statusColor[state.status] ?? chalk.white;

  console.log('');
  console.log(chalk.bold('  mAIker Run: ') + chalk.cyan(state.runId));
  console.log(`  ${chalk.gray('Project:')}  ${state.projectPath}`);
  console.log(`  ${chalk.gray('Goal:')}     ${state.goal}`);
  console.log(`  ${chalk.gray('Stage:')}    ${chalk.bold(state.currentStage)}`);
  console.log(`  ${chalk.gray('Status:')}   ${colour(state.status.toUpperCase())}`);

  if (state.currentAgent) {
    console.log(`  ${chalk.gray('Agent:')}    ${state.currentAgent}`);
  }

  if (state.currentAction) {
    console.log(`  ${chalk.gray('Action:')}   ${state.currentAction}`);
  }

  const runRetries = state.retryCounts['run'] ?? 0;
  if (runRetries > 0) {
    console.log(`  ${chalk.gray('Retries:')}  ${runRetries}`);
  }

  if (state.openIssues.length > 0) {
    console.log(`  ${chalk.gray('Issues:')}   ${chalk.yellow(String(state.openIssues.length))} open`);
  }

  const elapsed = Math.round(
    (Date.now() - new Date(state.createdAt).getTime()) / 1000,
  );
  console.log(`  ${chalk.gray('Elapsed:')}  ${formatDuration(elapsed)}`);
  console.log('');
}

// ─── Issue Rendering ──────────────────────────────────────────────────────────

export function renderIssue(issue: Issue): void {
  type ChalkFn = (text: string) => string;
  const sevColor: Record<string, ChalkFn> = {
    critical: chalk.bgRed.white,
    high: chalk.red,
    medium: chalk.yellow,
    low: chalk.gray,
  };
  const sev = sevColor[issue.severity] ?? chalk.white;

  console.log('');
  console.log(`  ${sev(`[${issue.severity.toUpperCase()}]`)} ${chalk.bold(issue.id)}`);
  console.log(`  ${chalk.gray('Category:')} ${issue.category}`);
  if (issue.page) console.log(`  ${chalk.gray('Page:')}     ${issue.page}`);
  if (issue.viewport) console.log(`  ${chalk.gray('Viewport:')} ${issue.viewport}`);
  console.log(`  ${chalk.gray('Observed:')} ${issue.observed}`);
  console.log(`  ${chalk.gray('Expected:')} ${issue.expected}`);
  if (issue.repairHint) console.log(`  ${chalk.gray('Hint:')}     ${issue.repairHint}`);
}

export function renderIssueList(issues: Issue[]): void {
  if (issues.length === 0) {
    success('No open issues');
    return;
  }
  section(`Open Issues (${issues.length})`);
  for (const issue of issues) {
    renderIssue(issue);
  }
}

// ─── Validation Results ───────────────────────────────────────────────────────

export function renderValidatorResult(result: ValidatorResult): void {
  const icon = result.status === 'passed' ? sym.check : result.status === 'failed' ? sym.cross : sym.bullet;
  const duration = result.duration ? chalk.gray(` (${result.duration}ms)`) : '';
  console.log(`  ${icon} ${result.name}${duration}`);
  if (result.error && result.status === 'failed') {
    const lines = result.error.split('\n').slice(0, 5);
    for (const line of lines) {
      console.log(`      ${chalk.red(line)}`);
    }
  }
}


// ─── Event Rendering ──────────────────────────────────────────────────────────

export function renderEvent(evt: MaikerEvent): void {
  const ts = chalk.gray(evt.timestamp.slice(11, 19));
  switch (evt.type) {
    case 'stage_started':
      console.log(`  ${ts} ${chalk.cyan('→ stage')} ${chalk.bold(evt.stage ?? '')}`);
      break;
    case 'agent_invoked':
      console.log(`  ${ts} ${chalk.magenta('⚡ agent')} ${evt.agent ?? ''}`);
      break;
    case 'tool_started':
      console.log(`  ${ts} ${chalk.blue('⚙ tool')}  ${evt.tool ?? ''}`);
      break;
    case 'validator_failed':
      console.log(`  ${ts} ${chalk.red('✗ validator')} ${evt.tool ?? ''} — ${(evt.data?.issueCount ?? 0)} issues`);
      break;
    case 'validator_passed':
      console.log(`  ${ts} ${chalk.green('✓ validator')} ${evt.tool ?? ''}`);
      break;
    case 'issue_created':
      console.log(`  ${ts} ${chalk.yellow('! issue')} ${evt.issueId ?? ''} [${evt.severity ?? ''}]`);
      break;
    case 'repair_started':
      console.log(`  ${ts} ${chalk.yellow('⟳ repair')} attempt ${(evt.data?.attempt ?? 1)}`);
      break;
    case 'context_added':
      console.log(`  ${ts} ${chalk.cyan('+ context')} added`);
      break;
    case 'run_completed':
      console.log(`  ${ts} ${chalk.green.bold('✓ run completed')}`);
      break;
    case 'run_failed':
      console.log(`  ${ts} ${chalk.red.bold('✗ run failed')} — ${evt.message ?? ''}`);
      break;
    default:
      console.log(`  ${ts} ${chalk.gray(evt.type)}`);
  }
}

// ─── Terminal Live Dashboard ──────────────────────────────────────────────────

export function renderDashboard(state: RunState): void {
  process.stdout.write('\x1Bc'); // clear terminal
  banner();
  renderRunStatus(state);

  console.log(chalk.gray('  Controls'));
  console.log(chalk.gray('  [p] pause  [r] resume  [c] add context  [a] artifacts'));
  console.log('');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

export function table(
  headers: string[],
  rows: string[][],
): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)),
  );
  const sep = widths.map((w) => '─'.repeat(w + 2)).join('┼');
  const head = headers
    .map((h, i) => ` ${chalk.bold(h.padEnd(widths[i]))} `)
    .join('│');
  console.log(`  ┌${sep.replace(/┼/g, '┬')}┐`);
  console.log(`  │${head}│`);
  console.log(`  ├${sep}┤`);
  for (const row of rows) {
    const line = row
      .map((c, i) => ` ${(c ?? '').padEnd(widths[i])} `)
      .join('│');
    console.log(`  │${line}│`);
  }
  console.log(`  └${sep.replace(/┼/g, '┴')}┘`);
}

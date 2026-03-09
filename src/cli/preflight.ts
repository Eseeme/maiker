import chalk from 'chalk';
import readline from 'readline';
import type { MaikerConfig, ValidatorName } from '../types/index.js';

// ─── Role display names ───────────────────────────────────────────────────────

const ROLE_LABELS: Record<keyof MaikerConfig['models'], string> = {
  researchIngestion: 'Research ingestion',
  planner:           'Planner',
  codeGeneration:    'Code generation',
  repairAgent:       'Repair',
  visualReview:      'Visual review',
  postApprovalReview:'Post-approval review',
};

// ─── Provider colour coding ───────────────────────────────────────────────────

function providerColour(provider: string): string {
  switch (provider.toLowerCase()) {
    case 'claude':  return chalk.magenta(provider);
    case 'openai':  return chalk.green(provider);
    case 'gemini':  return chalk.blue(provider);
    case 'pi-mono': return chalk.yellow(provider);
    default:        return chalk.gray(provider);
  }
}

// ─── Pre-flight screen ────────────────────────────────────────────────────────

export interface PreflightOptions {
  goal: string;
  projectPath: string;
  config: MaikerConfig;
  runId: string;
}

export async function showPreflight(opts: PreflightOptions): Promise<boolean> {
  const { goal, projectPath, config, runId } = opts;

  console.log('');
  console.log(chalk.bold('  Pre-flight check'));
  console.log(chalk.gray('  ────────────────────────────────────────'));
  console.log('');
  console.log(`  ${chalk.gray('Run ID:')}   ${chalk.cyan(runId)}`);
  console.log(`  ${chalk.gray('Project:')}  ${projectPath}`);
  console.log(`  ${chalk.gray('Goal:')}     ${chalk.bold(goal)}`);
  console.log('');

  // ── Agent model routing table ─────────────────────────────────────────────
  console.log(chalk.bold('  Agent Model Routing'));
  console.log('');

  const roles = Object.entries(config.models) as [
    keyof MaikerConfig['models'],
    MaikerConfig['models'][keyof MaikerConfig['models']],
  ][];

  const labelWidth = Math.max(...roles.map(([k]) => ROLE_LABELS[k].length)) + 2;

  for (const [key, mc] of roles) {
    const label = ROLE_LABELS[key].padEnd(labelWidth);
    const prov  = providerColour(mc.provider);
    const model = chalk.white(mc.model);
    console.log(`  ${chalk.gray(label)} ${prov}  ${model}`);
  }

  // ── Active validators ─────────────────────────────────────────────────────
  console.log('');
  console.log(chalk.bold('  Validators'));
  console.log('');

  const enabled = Object.entries(config.validators)
    .filter(([, on]) => on)
    .map(([name]) => name as ValidatorName);

  const disabled = Object.entries(config.validators)
    .filter(([, on]) => !on)
    .map(([name]) => name as ValidatorName);

  const enabledStr = enabled.map(v => chalk.green(v)).join('  ');
  const disabledStr = disabled.length > 0
    ? chalk.gray(disabled.join('  '))
    : chalk.gray('none');

  // wrap at ~80 chars
  console.log('  ' + wrapList(enabled.map(v => chalk.green(v)), 76, '  '));
  if (disabled.length > 0) {
    console.log(`  ${chalk.gray('skipped:')} ${chalk.gray(disabled.join(', '))}`);
  }

  // ── Policies ──────────────────────────────────────────────────────────────
  console.log('');
  console.log(chalk.bold('  Policies'));
  console.log('');
  console.log(`  ${chalk.gray('Max repairs / issue:')}  ${config.policies.maxAutoRepairsPerIssue}`);
  console.log(`  ${chalk.gray('Max repairs / run:')}    ${config.policies.maxAutoRepairsPerRun}`);
  console.log(`  ${chalk.gray('Human approval:')}       ${config.policies.requireHumanApproval ? chalk.yellow('required') : chalk.gray('skipped')}`);
  console.log(`  ${chalk.gray('Post-approval review:')} ${config.policies.postApprovalReviewRequired ? chalk.yellow('enabled') : chalk.gray('disabled')}`);

  console.log('');
  console.log(chalk.gray('  To change any model: edit maiker.config.yaml → models section'));
  console.log(chalk.gray('  To skip this check:  add --yes to the run command'));
  console.log('');

  // ── Prompt ────────────────────────────────────────────────────────────────
  return askConfirm('  Proceed with these settings? [Y/n] ');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function wrapList(items: string[], maxWidth: number, indent: string): string {
  const lines: string[] = [];
  let current = indent;
  for (const item of items) {
    // Strip ANSI for length check
    const plain = item.replace(/\x1B\[[0-9;]*m/g, '');
    if (current.replace(/\x1B\[[0-9;]*m/g, '').length + plain.length + 2 > maxWidth && current !== indent) {
      lines.push(current);
      current = indent + item;
    } else {
      current += (current === indent ? '' : '  ') + item;
    }
  }
  if (current !== indent) lines.push(current);
  return lines.join('\n');
}

function askConfirm(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    // If stdin is not a TTY (CI, pipes), default to yes
    if (!process.stdin.isTTY) {
      console.log(prompt + chalk.gray('(non-interactive, defaulting to yes)'));
      resolve(true);
      return;
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(chalk.bold(prompt), (answer) => {
      rl.close();
      const ans = answer.trim().toLowerCase();
      // Empty = yes (default), 'y' or 'yes' = yes, anything else = no
      resolve(ans === '' || ans === 'y' || ans === 'yes');
    });
  });
}

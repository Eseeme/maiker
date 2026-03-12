import chalk from 'chalk';
import readline from 'readline';
import type { MaikerConfig, ValidatorName, ModelConfig } from '../types/index.js';
import {
  detectAvailableProviders,
  explainChoice,
  getRoleLabel,
  recommendModels,
  getAvailableProviderNames,
} from '../core/models/index.js';
import type { AgentRole } from '../core/models/index.js';

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

export interface PreflightResult {
  confirmed: boolean;
  switchToDryRun?: boolean;
}

export async function showPreflight(opts: PreflightOptions): Promise<PreflightResult> {
  const { goal, projectPath, config, runId } = opts;

  console.log('');
  console.log(chalk.bold('  Pre-flight check'));
  console.log(chalk.gray('  ────────────────────────────────────────'));
  console.log('');
  console.log(`  ${chalk.gray('Run ID:')}   ${chalk.cyan(runId)}`);
  console.log(`  ${chalk.gray('Project:')}  ${projectPath}`);
  console.log(`  ${chalk.gray('Goal:')}     ${chalk.bold(goal)}`);
  console.log('');

  // ── API key validation ───────────────────────────────────────────────────
  const providers = detectAvailableProviders();
  const configuredProviders = new Set(
    Object.values(config.models).map((m: ModelConfig) => m.provider),
  );

  const missingKeys: string[] = [];
  for (const p of providers) {
    if (configuredProviders.has(p.provider) && !p.available) {
      missingKeys.push(p.provider);
    }
  }

  if (missingKeys.length > 0) {
    console.log(chalk.red.bold('  ⚠ Missing API keys'));
    console.log('');
    for (const name of missingKeys) {
      const p = providers.find(pr => pr.provider === name);
      const affectedRoles = Object.entries(config.models)
        .filter(([, m]) => (m as ModelConfig).provider === name)
        .map(([role]) => getRoleLabel(role as AgentRole));
      console.log(`    ${chalk.red('✗')} ${name}: ${chalk.gray(p?.envVar ?? '???')} not set`);
      console.log(`      ${chalk.gray('Affects:')} ${affectedRoles.join(', ')}`);
    }
    console.log('');

    // Suggest alternatives
    const available = getAvailableProviderNames();
    if (available.length > 0) {
      const recommended = recommendModels(available);
      console.log(chalk.yellow('  Suggested fix: switch missing roles to available providers:'));
      console.log('');
      for (const [role, mc] of Object.entries(config.models)) {
        if (missingKeys.includes((mc as ModelConfig).provider)) {
          const alt = recommended[role as AgentRole];
          const reason = explainChoice(alt, role as AgentRole);
          console.log(`    ${getRoleLabel(role as AgentRole).padEnd(24)} → ${providerColour(alt.provider)} ${alt.model} ${chalk.gray(`(${reason})`)}`);
        }
      }
      console.log('');
      console.log(chalk.gray('  Edit maiker.config.yaml to apply, or add the missing keys to .env'));
      console.log('');
    }
  }

  // ── Agent model routing table ─────────────────────────────────────────────
  console.log(chalk.bold('  Agent Model Routing'));
  console.log('');

  const roles = Object.entries(config.models) as [
    keyof MaikerConfig['models'],
    MaikerConfig['models'][keyof MaikerConfig['models']],
  ][];

  const labelWidth = Math.max(...roles.map(([k]) => getRoleLabel(k as AgentRole).length)) + 2;

  for (const [key, mc] of roles) {
    const label = getRoleLabel(key as AgentRole).padEnd(labelWidth);
    const prov = providerColour(mc.provider);
    const model = chalk.white(mc.model);
    const reason = chalk.gray(`(${explainChoice(mc, key as AgentRole)})`);
    const keyMissing = missingKeys.includes(mc.provider);
    const status = keyMissing ? chalk.red(' ← missing key') : '';
    console.log(`  ${chalk.gray(label)} ${prov}  ${model}  ${reason}${status}`);
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
  console.log(`  ${chalk.gray('Auto-replan at:')}       ${chalk.yellow('50% budget exhausted')}`);
  console.log(`  ${chalk.gray('Human approval:')}       ${config.policies.requireHumanApproval ? chalk.yellow('required') : chalk.gray('skipped')}`);
  console.log(`  ${chalk.gray('Post-approval review:')} ${config.policies.postApprovalReviewRequired ? chalk.yellow('enabled') : chalk.gray('disabled')}`);

  console.log('');
  console.log(chalk.gray('  To change any model: edit maiker.config.yaml → models section'));
  console.log(chalk.gray('  To skip this check:  add --yes to the run command'));
  console.log('');

  // ── Block if keys are missing ──────────────────────────────────────────────
  if (missingKeys.length > 0) {
    console.log(chalk.red.bold('  Cannot proceed: missing API keys for configured providers.'));
    console.log(chalk.gray('  Fix: add the keys to .env, or change the models in maiker.config.yaml.\n'));
    return { confirmed: false };
  }

  // ── Prompt ────────────────────────────────────────────────────────────────
  while (true) {
    const answer = await askChoice(
      '  Proceed with these settings? [Y/n/e] ',
      ['y', 'n', 'e'],
      'y',
    );

    if (answer === 'y') return { confirmed: true };

    if (answer === 'e') {
      console.log('');
      console.log(chalk.gray('  Edit maiker.config.yaml and save, then come back here.'));
      console.log(chalk.gray('  Waiting... press Enter when ready.'));
      await waitForEnter();
      console.log(chalk.gray('  Config will be re-read on next run. Re-checking...'));
      continue;
    }

    // answer === 'n'
    console.log('');
    console.log(chalk.bold('  What would you like to do?'));
    console.log('');
    console.log(`    ${chalk.cyan('1')}  Edit config and retry`);
    console.log(`    ${chalk.cyan('2')}  Run in dry-run mode (plan only, no changes)`);
    console.log(`    ${chalk.cyan('3')}  Quit`);
    console.log('');

    const choice = await askChoice('  Choice [1/2/3]: ', ['1', '2', '3'], '3');

    if (choice === '1') {
      console.log('');
      console.log(chalk.gray('  Edit maiker.config.yaml, then press Enter to re-check.'));
      await waitForEnter();
      continue;
    }

    if (choice === '2') {
      console.log(chalk.yellow('  → Switching to dry-run mode (plan only)'));
      return { confirmed: true, switchToDryRun: true };
    }

    // choice === '3'
    return { confirmed: false };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function wrapList(items: string[], maxWidth: number, indent: string): string {
  const lines: string[] = [];
  let current = indent;
  for (const item of items) {
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

function askChoice(prompt: string, valid: string[], defaultChoice: string): Promise<string> {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      console.log(prompt + chalk.gray(`(non-interactive, defaulting to ${defaultChoice})`));
      resolve(defaultChoice);
      return;
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(chalk.bold(prompt), (answer) => {
      rl.close();
      const ans = answer.trim().toLowerCase();
      if (ans === '' || ans === 'yes') resolve(defaultChoice);
      else if (valid.includes(ans)) resolve(ans);
      else resolve(defaultChoice);
    });
  });
}

function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) { resolve(); return; }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(chalk.gray('  Press Enter to continue...'), () => { rl.close(); resolve(); });
  });
}

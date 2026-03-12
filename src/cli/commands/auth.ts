import { Command } from 'commander';
import chalk from 'chalk';
import { banner, success, fail } from '../output/index.js';
import {
  detectAvailableProviders,
  validateProviderKey,
  getRoleLabel,
  explainChoice,
} from '../../core/models/index.js';
import type { AgentRole } from '../../core/models/index.js';
import { loadConfig } from '../../config/index.js';
import type { ModelConfig } from '../../types/index.js';
import { detectOAuthToken } from '../oauth.js';

export function createAuthCommand(): Command {
  return new Command('auth')
    .description('Check API key status and provider connectivity')
    .option('--validate', 'Test each key with a real API call')
    .option('--config <path>', 'Path to maiker.config.yaml')
    .action(async (opts: { validate?: boolean; config?: string }) => {
      banner();

      console.log(chalk.bold('  Authentication Status'));
      console.log(chalk.gray('  ────────────────────────────────────────'));
      console.log('');

      // ── Detect env keys ──────────────────────────────────────────────
      const providers = detectAvailableProviders();

      console.log(chalk.bold('  API Keys'));
      console.log('');

      for (const p of providers) {
        const status = p.available
          ? chalk.green('✓ found')
          : chalk.gray('✗ not set');
        console.log(`    ${p.provider.padEnd(10)} ${p.envVar.padEnd(22)} ${status}`);
      }

      // ── Claude Code OAuth ────────────────────────────────────────────
      console.log('');
      console.log(chalk.bold('  Claude Code OAuth'));
      console.log('');

      const oauth = detectOAuthToken();

      if (oauth.found && oauth.token) {
        const sourceLabel = oauth.source === 'keychain' ? 'macOS Keychain' : 'credentials file';

        if (oauth.hoursLeft !== undefined && oauth.hoursLeft > 0) {
          console.log(`    ${chalk.green('✓')} OAuth token found (${sourceLabel})`);
          console.log(`    ${chalk.gray('Expires in:')} ${oauth.hoursLeft.toFixed(1)} hours`);

          const currentEnvKey = process.env.ANTHROPIC_API_KEY ?? '';
          if (currentEnvKey.startsWith('sk-ant-oat')) {
            console.log(`    ${chalk.green('✓')} Active — being used as ANTHROPIC_API_KEY`);
          } else if (!currentEnvKey) {
            console.log(`    ${chalk.green('✓')} Active — will be used (no .env key set)`);
          } else {
            console.log(`    ${chalk.gray('ℹ')} Not used — .env has a non-OAuth ANTHROPIC_API_KEY`);
          }
        } else {
          console.log(`    ${chalk.red('✗')} OAuth token expired (${Math.abs(oauth.hoursLeft ?? 0).toFixed(1)} hours ago)`);
          console.log(`    ${chalk.gray('Fix:')} ${chalk.cyan('claude auth login')}`);
        }
      } else {
        console.log(`    ${chalk.gray('✗')} ${oauth.error ?? 'No OAuth token found'}`);
        console.log(`    ${chalk.gray('To set up:')} ${chalk.cyan('claude auth login')}`);
      }

      // ── Validate keys (optional) ────────────────────────────────────
      if (opts.validate) {
        console.log('');
        console.log(chalk.bold('  Validation'));
        console.log('');

        for (const p of providers) {
          if (!p.available) continue;

          process.stdout.write(`    ${p.provider.padEnd(10)} `);
          const result = await validateProviderKey(p.provider);
          if (result.valid) {
            console.log(chalk.green('✓ connected'));
          } else {
            console.log(chalk.red(`✗ failed: ${result.error}`));
          }
        }
      }

      // ── Config routing (if config exists) ────────────────────────────
      try {
        const config = loadConfig(opts.config);
        console.log('');
        console.log(chalk.bold('  Configured Model Routing'));
        console.log('');

        const roles = Object.entries(config.models) as [string, ModelConfig][];
        const availableProviderNames = providers.filter(p => p.available).map(p => p.provider);

        for (const [role, mc] of roles) {
          const label = getRoleLabel(role as AgentRole).padEnd(24);
          const provColor = mc.provider === 'claude' ? chalk.magenta
            : mc.provider === 'openai' ? chalk.green
            : mc.provider === 'gemini' ? chalk.blue
            : chalk.gray;
          const keyOk = availableProviderNames.includes(mc.provider);
          const keyStatus = keyOk
            ? chalk.green('✓')
            : chalk.red('✗ missing key');
          const reason = chalk.gray(`(${explainChoice(mc, role as AgentRole)})`);

          console.log(`    ${label} ${provColor(mc.provider.padEnd(10))} ${mc.model.padEnd(24)} ${keyStatus} ${reason}`);
        }
      } catch {
        console.log('');
        console.log(chalk.gray('  No maiker.config.yaml found. Run: maiker init'));
      }

      // ── Summary ──────────────────────────────────────────────────────
      console.log('');
      const available = providers.filter(p => p.available);
      if (available.length > 0) {
        success(`${available.length} provider(s) available: ${available.map(p => p.provider).join(', ')}`);
      } else {
        fail('No API keys detected');
        console.log('');
        console.log(chalk.gray('  Options:'));
        console.log(`    ${chalk.cyan('claude auth login')}              ${chalk.gray('Auto-detect Claude Code OAuth')}`);
        console.log(`    ${chalk.cyan('echo "ANTHROPIC_API_KEY=..." > .env')}  ${chalk.gray('Set key in .env')}`);
      }

      if (!opts.validate && available.length > 0) {
        console.log('');
        console.log(chalk.gray('  Run with --validate to test API connectivity'));
      }

      console.log('');
    });
}

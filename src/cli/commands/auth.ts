import { Command } from 'commander';
import chalk from 'chalk';
import { banner, success, fail, info } from '../output/index.js';
import {
  detectAvailableProviders,
  validateProviderKey,
  getRoleLabel,
  explainChoice,
} from '../../core/models/index.js';
import type { AgentRole } from '../../core/models/index.js';
import { loadConfig } from '../../config/index.js';
import type { ModelConfig } from '../../types/index.js';
import { detectOAuthToken, applyOAuthToken } from '../oauth.js';
import { shouldUseClaudeCode, isClaudeCodeAvailable } from '../../providers/claude-code/index.js';

export function createAuthCommand(): Command {
  const auth = new Command('auth')
    .description('Check API key status, provider connectivity, and manage OAuth');

  // ── maiker auth (default: status) ──────────────────────────────────────────
  auth
    .option('--validate', 'Test each key with a real API call')
    .option('--config <path>', 'Path to maiker.config.yaml')
    .action(async (opts: { validate?: boolean; config?: string }) => {
      banner();

      console.log(chalk.bold('  Authentication Status'));
      console.log(chalk.gray('  ────────────────────────────────────────'));
      console.log('');

      // ── Claude Code OAuth ────────────────────────────────────────────
      console.log(chalk.bold('  Claude Code OAuth'));
      console.log('');

      const oauth = detectOAuthToken();

      if (oauth.found && oauth.token) {
        const sourceLabel = oauth.source === 'keychain' ? 'macOS Keychain' : 'credentials file';

        if (oauth.hoursLeft !== undefined && oauth.hoursLeft > 0) {
          console.log(`    ${chalk.green('✓')} OAuth token found (${sourceLabel})`);
          console.log(`    ${chalk.gray('Expires in:')} ${oauth.hoursLeft.toFixed(1)} hours`);

          // OAuth tokens can't call the Messages API directly.
          // When detected, maiker routes through Claude Code subprocess.
          if (shouldUseClaudeCode()) {
            console.log(`    ${chalk.green('✓')} Active — will route via Claude Code subprocess`);
            console.log(`    ${chalk.gray('ℹ')} OAuth tokens work through Claude Code CLI, not the API directly`);
          } else if (isClaudeCodeAvailable()) {
            console.log(`    ${chalk.green('✓')} Claude Code available (will use for OAuth routing)`);
          } else {
            console.log(`    ${chalk.yellow('⚠')} Claude Code CLI not found — OAuth tokens need it`);
            console.log(`    ${chalk.gray('Fix:')} ${chalk.cyan('npm install -g @anthropic-ai/claude-code')}`);
            console.log(`    ${chalk.gray('  or:')} Set a direct ANTHROPIC_API_KEY in .env`);
          }
        } else {
          console.log(`    ${chalk.red('✗')} OAuth token expired (${Math.abs(oauth.hoursLeft ?? 0).toFixed(1)} hours ago)`);
          console.log(`    ${chalk.gray('Fix:')} ${chalk.cyan('maiker auth refresh')}  or  ${chalk.cyan('claude auth login')}`);
        }
      } else {
        console.log(`    ${chalk.gray('✗')} ${oauth.error ?? 'No OAuth token found'}`);
        console.log(`    ${chalk.gray('To set up:')} ${chalk.cyan('claude auth login')}`);
      }

      // ── Detect env keys ──────────────────────────────────────────────
      console.log('');
      console.log(chalk.bold('  API Keys'));
      console.log('');

      const providers = detectAvailableProviders();

      for (const p of providers) {
        if (p.available && p.source === 'oauth') {
          console.log(`    ${p.provider.padEnd(10)} ${p.envVar.padEnd(22)} ${chalk.green('✓ via OAuth')}`);
        } else if (p.available) {
          console.log(`    ${p.provider.padEnd(10)} ${p.envVar.padEnd(22)} ${chalk.green('✓ found')}`);
        } else {
          console.log(`    ${p.provider.padEnd(10)} ${p.envVar.padEnd(22)} ${chalk.gray('✗ not set')}`);
        }
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

  // ── maiker auth refresh ────────────────────────────────────────────────────
  auth
    .command('refresh')
    .description('Re-detect Claude Code OAuth token and apply it')
    .action(async () => {
      banner();

      console.log(chalk.bold('  Refreshing Authentication'));
      console.log(chalk.gray('  ────────────────────────────────────────'));
      console.log('');

      // Re-detect OAuth token from Claude Code credentials
      const oauth = detectOAuthToken();

      if (!oauth.found || !oauth.token) {
        fail('No Claude Code OAuth token found');
        console.log('');
        console.log(chalk.gray('  Claude Code is not logged in, or credentials file is missing.'));
        console.log('');
        console.log(chalk.gray('  To fix:'));
        console.log(`    1. Install Claude Code:  ${chalk.cyan('npm install -g @anthropic-ai/claude-code')}`);
        console.log(`    2. Log in:               ${chalk.cyan('claude auth login')}`);
        console.log(`    3. Re-run:               ${chalk.cyan('maiker auth refresh')}`);
        console.log('');
        return;
      }

      if (oauth.hoursLeft !== undefined && oauth.hoursLeft <= 0) {
        fail(`OAuth token expired ${Math.abs(oauth.hoursLeft).toFixed(1)} hours ago`);
        console.log('');
        console.log(chalk.gray('  Your Claude Code session has expired.'));
        console.log(`  Run ${chalk.cyan('claude auth login')} to get a new token, then ${chalk.cyan('maiker auth refresh')}`);
        console.log('');
        return;
      }

      // Apply the token to the current process
      applyOAuthToken();

      const sourceLabel = oauth.source === 'keychain' ? 'macOS Keychain' : 'credentials file';
      success(`OAuth token refreshed from ${sourceLabel}`);
      console.log(`    ${chalk.gray('Expires in:')} ${oauth.hoursLeft!.toFixed(1)} hours`);
      console.log(`    ${chalk.gray('Token type:')} Claude Code OAuth (${oauth.token.slice(0, 16)}...)`);
      console.log('');

      // Validate the token actually works
      process.stdout.write(`    Validating token... `);
      const result = await validateProviderKey('claude');
      if (result.valid) {
        console.log(chalk.green('✓ connected'));
      } else {
        console.log(chalk.red(`✗ ${result.error}`));
        console.log('');
        console.log(chalk.gray('  Token was found but failed validation.'));
        console.log(`  Try: ${chalk.cyan('claude auth login')} to get a fresh token.`);
      }

      console.log('');
      info('OAuth is auto-detected every time you run maiker. No need to refresh unless troubleshooting.');
      console.log('');
    });

  return auth;
}

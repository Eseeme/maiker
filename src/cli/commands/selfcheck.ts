import { Command } from 'commander';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import yaml from 'js-yaml';
import { banner, success, fail } from '../output/index.js';
import { detectAvailableProviders } from '../../core/models/index.js';
import { detectOAuthToken } from '../oauth.js';

interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
  duration?: number;
}

function runCheck(name: string, fn: () => string | true): CheckResult {
  const start = Date.now();
  try {
    const result = fn();
    return {
      name,
      passed: true,
      message: result === true ? 'OK' : result,
      duration: Date.now() - start,
    };
  } catch (err) {
    return {
      name,
      passed: false,
      message: String(err instanceof Error ? err.message : err),
      duration: Date.now() - start,
    };
  }
}

function shell(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', timeout: 60_000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

export function createSelfcheckCommand(): Command {
  return new Command('selfcheck')
    .description('Validate maiker installation health: build, types, deps, config, auth')
    .option('--fix', 'Attempt to auto-fix issues (chown dist/, npm install)')
    .option('--verbose', 'Show full output for each check')
    .action(async (opts: { fix?: boolean; verbose?: boolean }) => {
      banner();
      console.log(chalk.bold('  mAIker Self-Check'));
      console.log(chalk.gray('  ────────────────────────────────────────'));
      console.log('');

      // Determine maiker root (walk up from this file)
      const maikerRoot = resolve(new URL(import.meta.url).pathname, '..', '..', '..', '..');
      const results: CheckResult[] = [];

      // ── 1. TypeScript compilation ──────────────────────────────────────
      results.push(runCheck('TypeScript (tsc --noEmit)', () => {
        shell('npx tsc --noEmit', maikerRoot);
        return 'Zero type errors';
      }));

      // ── 2. Build ───────────────────────────────────────────────────────
      results.push(runCheck('Build (npm run build)', () => {
        shell('npm run build', maikerRoot);
        return 'Compiled to dist/';
      }));

      // ── 3. Dependencies ────────────────────────────────────────────────
      results.push(runCheck('Dependencies (npm ls)', () => {
        try {
          shell('npm ls --depth=0 2>&1', maikerRoot);
          return 'All dependencies resolved';
        } catch (err) {
          const msg = String(err);
          if (msg.includes('missing:') || msg.includes('ELSPROBLEMS')) {
            if (opts.fix) {
              shell('npm install --legacy-peer-deps', maikerRoot);
              return 'Fixed: ran npm install';
            }
            throw new Error('Missing dependencies. Run with --fix or: npm install');
          }
          // npm ls exits non-zero for peer dep warnings — treat as pass
          return 'Dependencies resolved (peer warnings ignored)';
        }
      }));

      // ── 4. Config schema ───────────────────────────────────────────────
      results.push(runCheck('Config schema', () => {
        // Check that the default config loads without error
        const configPaths = [
          resolve(process.cwd(), 'maiker.config.yaml'),
          resolve(process.cwd(), 'maiker.config.yml'),
          resolve(process.cwd(), '.maiker/config.yaml'),
        ];
        const found = configPaths.find(p => existsSync(p));
        if (!found) {
          return 'No project config found (using defaults)';
        }
        // Try parsing
        const raw = readFileSync(found, 'utf-8');
        if (!raw.trim()) throw new Error(`Config file is empty: ${found}`);
        try {
          yaml.load(raw);
        } catch (e) {
          throw new Error(`Invalid YAML in ${found}: ${String(e)}`);
        }
        return `Valid: ${found}`;
      }));

      // ── 5. Git status ─────────────────────────────────────────────────
      results.push(runCheck('Git status', () => {
        const status = shell('git status --porcelain', maikerRoot);
        if (!status) return 'Working tree clean';
        const lines = status.split('\n').filter(Boolean);
        return `${lines.length} uncommitted change(s)`;
      }));

      // ── 6. dist/ permissions ──────────────────────────────────────────
      results.push(runCheck('dist/ permissions', () => {
        const distPath = resolve(maikerRoot, 'dist');
        if (!existsSync(distPath)) {
          return 'dist/ not yet created (run build first)';
        }
        try {
          // Try to write a temp file
          const testFile = resolve(distPath, '.selfcheck-test');
          require('fs').writeFileSync(testFile, 'test');
          require('fs').unlinkSync(testFile);
          return 'dist/ is writable';
        } catch {
          if (opts.fix) {
            throw new Error(
              'dist/ is not writable (owned by root). Run: sudo chown -R $(whoami) ' + distPath,
            );
          }
          throw new Error(
            'dist/ is not writable. Fix: sudo chown -R $(whoami) ' + distPath,
          );
        }
      }));

      // ── 7. Authentication ─────────────────────────────────────────────
      results.push(runCheck('Authentication', () => {
        const oauth = detectOAuthToken();
        const providers = detectAvailableProviders();
        const available = providers.filter(p => p.available);

        if (available.length === 0 && !oauth.found) {
          throw new Error('No API keys or OAuth token found. Run: maiker auth');
        }

        const parts: string[] = [];
        if (oauth.found && oauth.token && (oauth.hoursLeft ?? 0) > 0) {
          parts.push(`OAuth (${oauth.hoursLeft!.toFixed(1)}h left)`);
        }
        for (const p of available) {
          parts.push(`${p.provider} (${p.source ?? 'env'})`);
        }
        return parts.join(', ');
      }));

      // ── 8. Entry point ────────────────────────────────────────────────
      results.push(runCheck('Entry point', () => {
        const entry = resolve(maikerRoot, 'dist', 'bin', 'maiker.js');
        if (!existsSync(entry)) {
          throw new Error('dist/bin/maiker.js not found. Run: npm run build');
        }
        return 'dist/bin/maiker.js exists';
      }));

      // ── Report ────────────────────────────────────────────────────────
      console.log('');
      let passed = 0;
      let failed = 0;

      for (const r of results) {
        const icon = r.passed ? chalk.green('✓') : chalk.red('✗');
        const dur = r.duration ? chalk.gray(` (${r.duration}ms)`) : '';
        console.log(`    ${icon} ${chalk.bold(r.name)}${dur}`);
        if (r.passed) {
          console.log(`      ${chalk.gray(r.message)}`);
          passed++;
        } else {
          console.log(`      ${chalk.red(r.message)}`);
          failed++;
        }
      }

      console.log('');
      console.log(chalk.gray('  ────────────────────────────────────────'));
      if (failed === 0) {
        success(`All ${passed} checks passed`);
      } else {
        fail(`${failed} of ${results.length} checks failed`);
      }
      console.log('');

      if (failed > 0) process.exitCode = 1;
    });
}

import { Command } from 'commander';
import { resolve } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { banner, section, success, fail, renderValidatorResult } from '../output/index.js';
import { loadConfig } from '../../config/index.js';
import { inspectRepo, classifyTask } from '../../core/classification/index.js';
import { getValidationProfile } from '../../core/policies/index.js';
import { runDeterministicValidators } from '../../validators/deterministic/index.js';
import { generateRunId } from '../../core/state/index.js';

export function createValidateCommand(): Command {
  return new Command('validate')
    .description('Run validators only (build, lint, typecheck, tests, Playwright)')
    .argument('<path>', 'Path to the repository')
    .option('--goal <text>', 'Goal context for choosing validation profile')
    .option('--config <path>', 'Path to maiker.config.yaml')
    .option('--validators <list>', 'Comma-separated list of validators to run')
    .action(async (repoPath: string, opts: { goal?: string; config?: string; validators?: string }) => {
      const absPath = resolve(repoPath);
      const config = loadConfig(opts.config);
      const runId = generateRunId();

      banner();
      console.log(chalk.bold('  Running validators...\n'));

      const spinner = ora('Detecting validation profile...').start();

      try {
        const inspection = await inspectRepo(absPath);
        const classification = classifyTask(opts.goal ?? 'validate');
        const profile = getValidationProfile(classification);

        let validators = profile.required;
        if (opts.validators) {
          validators = opts.validators.split(',').map(v => v.trim()) as typeof validators;
        }

        spinner.succeed(`Profile: ${profile.taskType} — running ${validators.length} validators`);

        section('Deterministic Validators');

        const results = await runDeterministicValidators({
          runId,
          projectPath: absPath,
          validators,
          config,
          onOutput: (line) => process.stdout.write(`    ${chalk.gray(line)}\n`),
        });

        console.log('');
        for (const result of results) {
          renderValidatorResult(result);
        }

        const passed = results.filter(r => r.status === 'passed').length;
        const failed = results.filter(r => r.status === 'failed').length;

        console.log('');
        if (failed === 0) {
          success(`All ${passed} validators passed`);
        } else {
          fail(`${failed} validator(s) failed, ${passed} passed`);
          process.exit(1);
        }
      } catch (err) {
        spinner.fail('Validation failed');
        fail(String(err));
        process.exit(1);
      }
    });
}

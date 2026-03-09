import { Command } from 'commander';
import { resolve } from 'path';
import ora from 'ora';
import chalk from 'chalk';
import { banner, section, success, fail } from '../output/index.js';
import { loadConfig } from '../../config/index.js';
import { findRun } from '../../core/state/index.js';
import { runPostApprovalReviewAgent } from '../../agents/review/index.js';
import { getFullDiff } from '../../tools/git/index.js';

export function createReviewCommand(): Command {
  return new Command('review')
    .description('Run post-approval review to detect hidden regressions and scope drift')
    .argument('<path>', 'Path to the repository')
    .option('--run-id <id>', 'Run ID to review')
    .option('--config <path>', 'Path to maiker.config.yaml')
    .action(async (repoPath: string, opts: { runId?: string; config?: string }) => {
      const absPath = resolve(repoPath);
      const config = loadConfig(opts.config);

      banner();

      if (!opts.runId) {
        fail('--run-id is required');
        process.exit(1);
      }

      const spinner = ora('Running post-approval review...').start();

      try {
        const run = await findRun(opts.runId, config.artifacts.outputDir);
        if (!run) {
          spinner.fail(`Run not found: ${opts.runId}`);
          process.exit(1);
        }

        const diff = await getFullDiff(absPath).catch(() => 'No diff available');

        const output = await runPostApprovalReviewAgent(
          {
            runId: opts.runId,
            goal: run.goal,
            projectPath: absPath,
            diffSummary: diff,
            validationHistory: run.validationResults ?? [],
            testsModified: [],
            touchedFiles: run.plan?.fileTargetHints ?? [],
          },
          config,
        );

        spinner.succeed('Post-approval review complete');

        section('Review Summary');
        console.log(`  Overall Risk: ${chalk.bold(output.overallRisk.toUpperCase())}`);
        console.log(`\n  ${output.summary}`);

        if (output.regressionFindings.length > 0) {
          section('Regression Findings');
          for (const f of output.regressionFindings) console.log(`  ${chalk.red('•')} ${f}`);
        }

        if (output.scopeDriftFindings.length > 0) {
          section('Scope Drift');
          for (const f of output.scopeDriftFindings) console.log(`  ${chalk.yellow('•')} ${f}`);
        }

        if (output.suspiciousChurnFindings.length > 0) {
          section('Suspicious Churn');
          for (const f of output.suspiciousChurnFindings) console.log(`  ${chalk.gray('•')} ${f}`);
        }

        console.log('');
        success('Review complete');
      } catch (err) {
        spinner.fail('Review failed');
        fail(String(err));
        process.exit(1);
      }
    });
}

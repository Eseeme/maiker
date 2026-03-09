import { Command } from 'commander';
import { resolve } from 'path';
import ora from 'ora';
import chalk from 'chalk';
import { banner, section, success, fail, renderIssueList } from '../output/index.js';
import { loadConfig } from '../../config/index.js';
import { findRun, getOpenIssues } from '../../core/state/index.js';
import { runRepairAgent } from '../../agents/repair/index.js';

export function createRepairCommand(): Command {
  return new Command('repair')
    .description('Apply targeted repairs using existing issue files from a run')
    .argument('<path>', 'Path to the repository')
    .option('--run-id <id>', 'Run ID to repair issues from')
    .option('--config <path>', 'Path to maiker.config.yaml')
    .action(async (repoPath: string, opts: { runId?: string; config?: string }) => {
      const absPath = resolve(repoPath);
      const config = loadConfig(opts.config);

      banner();

      if (!opts.runId) {
        fail('--run-id is required. Use: maiker repair ./app --run-id <id>');
        process.exit(1);
      }

      const spinner = ora(`Loading run ${opts.runId}...`).start();

      try {
        const run = await findRun(opts.runId, config.artifacts.outputDir);
        if (!run) {
          spinner.fail(`Run not found: ${opts.runId}`);
          process.exit(1);
        }

        const issues = await getOpenIssues(opts.runId, config.artifacts.outputDir);
        spinner.succeed(`Found ${issues.length} open issues`);

        if (issues.length === 0) {
          success('No open issues to repair');
          return;
        }

        section('Open Issues');
        renderIssueList(issues);

        const repairSpinner = ora('Running repair agent...').start();

        // Build per-issue attempt counts
        const issueAttempts: Record<string, number> = {};
        for (const issue of issues) {
          issueAttempts[issue.id] = run.retryCounts[`issue:${issue.id}`] ?? 0;
        }

        const repairOutput = await runRepairAgent(
          {
            runId: opts.runId,
            goal: run.goal,
            projectPath: absPath,
            issues,
            validatorEvidence: 'Manual repair invocation',
            touchedFiles: run.plan?.fileTargetHints ?? [],
            priorAttempts: run.retryCounts['run'] ?? 0,
            issueAttempts,
            priorRepairNotes: [],
          },
          config,
        );

        repairSpinner.succeed('Repair agent completed');

        section('Repair Plan');
        console.log(`\n  ${chalk.bold('Patch Plan:')}`);
        console.log(`  ${repairOutput.patchPlan}`);
        console.log(`\n  ${chalk.bold('Changed Files:')}`);
        for (const f of repairOutput.changedFiles) {
          console.log(`  ${chalk.cyan('•')} ${f}`);
        }
        console.log(`\n  ${chalk.bold('Expected Impact:')} ${repairOutput.expectedImpact}`);
        console.log(`  ${chalk.bold('Residual Risk:')} ${repairOutput.residualRisk}`);

        console.log('');
        success('Repair plan generated. Apply and re-validate with: maiker validate ' + repoPath);
      } catch (err) {
        spinner.fail('Repair failed');
        fail(String(err));
        process.exit(1);
      }
    });
}

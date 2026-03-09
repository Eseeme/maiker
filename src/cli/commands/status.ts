import { Command } from 'commander';
import chalk from 'chalk';
import { banner, renderRunStatus, section, fail, table } from '../output/index.js';
import { loadConfig } from '../../config/index.js';
import { listRuns, findRun, getLatestRun, getOpenIssues } from '../../core/state/index.js';

export function createStatusCommand(): Command {
  return new Command('status')
    .description('Show the status of the latest or a specific run')
    .option('--run-id <id>', 'Show status for a specific run ID')
    .option('--all', 'List all runs')
    .option('--config <path>', 'Path to maiker.config.yaml')
    .action(async (opts: { runId?: string; all?: boolean; config?: string }) => {
      const config = loadConfig(opts.config);

      banner();

      try {
        if (opts.all) {
          const runs = await listRuns(config.artifacts.outputDir);
          if (runs.length === 0) {
            console.log(chalk.gray('  No runs found'));
            return;
          }

          section(`All Runs (${runs.length})`);
          table(
            ['Run ID', 'Status', 'Stage', 'Goal', 'Created'],
            runs.map((r) => [
              r.runId.slice(0, 24),
              r.status,
              r.currentStage,
              r.goal.slice(0, 40),
              r.createdAt.slice(0, 10),
            ]),
          );
          return;
        }

        const run = opts.runId
          ? await findRun(opts.runId, config.artifacts.outputDir)
          : await getLatestRun(config.artifacts.outputDir);

        if (!run) {
          console.log(chalk.gray('  No runs found. Start one with: maiker run ./your-project --goal "..."'));
          return;
        }

        renderRunStatus(run);

        if (run.openIssues.length > 0) {
          const issues = await getOpenIssues(run.runId, config.artifacts.outputDir);
          section(`Open Issues (${issues.length})`);
          for (const issue of issues) {
            const sevColor = issue.severity === 'critical' || issue.severity === 'high'
              ? chalk.red : chalk.yellow;
            console.log(
              `  ${sevColor(`[${issue.severity}]`)} ${issue.id} — ${issue.observed.slice(0, 60)}`,
            );
          }
          console.log('');
        }

        if (run.contextUpdates.length > 0) {
          section('Context Updates');
          for (const update of run.contextUpdates) {
            console.log(`  ${chalk.gray(update.addedAt.slice(11, 19))} [${update.impact}] ${update.message}`);
          }
          console.log('');
        }

        // Controls hint
        console.log(chalk.gray('  Commands:'));
        if (run.status === 'running') {
          console.log(chalk.gray(`    maiker pause --run-id ${run.runId}`));
          console.log(chalk.gray(`    maiker context add --run-id ${run.runId} --message "..."`));
        }
        if (run.status === 'paused') {
          console.log(chalk.gray(`    maiker resume --run-id ${run.runId}`));
        }
        console.log(chalk.gray(`    maiker logs --run-id ${run.runId} --follow`));
        console.log('');

      } catch (err) {
        fail(String(err));
        process.exit(1);
      }
    });
}

import { Command } from 'commander';
import chalk from 'chalk';
import { banner, success, fail, section } from '../output/index.js';
import { loadConfig } from '../../config/index.js';
import { findRun, getLatestRun, addContextUpdate, getContextUpdates } from '../../core/state/index.js';
import { emitContextAdded } from '../../artifacts/events.js';
import { analyseContextImpact } from '../../core/policies/index.js';

export function createContextCommand(): Command {
  const context = new Command('context')
    .description('Manage in-flight context updates for a run');

  // context add
  context
    .command('add')
    .description('Add a context update to a running workflow')
    .option('--run-id <id>', 'Run ID to update')
    .option('--message <text>', 'Context message to inject')
    .option('--config <path>', 'Path to maiker.config.yaml')
    .action(async (opts: { runId?: string; message?: string; config?: string }) => {
      const config = loadConfig(opts.config);
      banner();

      if (!opts.message) {
        fail('--message is required');
        process.exit(1);
      }

      try {
        const run = opts.runId
          ? await findRun(opts.runId, config.artifacts.outputDir)
          : await getLatestRun(config.artifacts.outputDir);

        if (!run) {
          fail('No run found. Specify --run-id');
          process.exit(1);
        }

        const impact = analyseContextImpact(opts.message, run.currentStage);
        const update = await addContextUpdate(
          run.runId,
          opts.message,
          impact,
          config.artifacts.outputDir,
        );

        emitContextAdded(run.runId, opts.message);

        success('Context update added');
        console.log(`  Impact:  ${chalk.bold(impact)}`);
        console.log(`  Action:  ${update.action}`);
        console.log(`  Message: ${opts.message}`);

        if (impact === 'high') {
          console.log(`\n  ${chalk.yellow('⚠')} High impact — downstream stages will be replanned`);
        } else if (impact === 'medium') {
          console.log(`\n  ${chalk.cyan('ℹ')} Medium impact — current stage will be rerun`);
        }
        console.log('');

      } catch (err) {
        fail(String(err));
        process.exit(1);
      }
    });

  // context show
  context
    .command('show')
    .description('Show context updates for a run')
    .option('--run-id <id>', 'Run ID')
    .option('--config <path>', 'Path to maiker.config.yaml')
    .action(async (opts: { runId?: string; config?: string }) => {
      const config = loadConfig(opts.config);
      banner();

      try {
        const run = opts.runId
          ? await findRun(opts.runId, config.artifacts.outputDir)
          : await getLatestRun(config.artifacts.outputDir);

        if (!run) {
          fail('No run found');
          process.exit(1);
        }

        const updates = await getContextUpdates(run.runId, config.artifacts.outputDir);

        if (updates.length === 0) {
          console.log(chalk.gray('  No context updates for this run'));
          return;
        }

        section(`Context History for ${run.runId}`);
        for (const update of updates) {
          const impactColor =
            update.impact === 'high'
              ? chalk.red
              : update.impact === 'medium'
                ? chalk.yellow
                : chalk.gray;
          console.log(`\n  ${chalk.gray(update.addedAt.slice(11, 19))} ${impactColor(`[${update.impact}]`)}`);
          console.log(`  ${update.message}`);
          console.log(`  ${chalk.gray('Action:')} ${update.action}`);
        }
        console.log('');
      } catch (err) {
        fail(String(err));
        process.exit(1);
      }
    });

  return context;
}

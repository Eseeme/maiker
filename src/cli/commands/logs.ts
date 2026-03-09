import { Command } from 'commander';
import chalk from 'chalk';
import { banner, fail, renderEvent } from '../output/index.js';
import { loadConfig } from '../../config/index.js';
import { findRun, getLatestRun } from '../../core/state/index.js';
import { streamRunEvents } from '../../artifacts/events.js';

export function createLogsCommand(): Command {
  return new Command('logs')
    .description('Stream or show run event logs')
    .option('--run-id <id>', 'Run ID to stream logs from')
    .option('--follow', 'Tail log in real time', false)
    .option('--raw', 'Print raw JSON events')
    .option('--config <path>', 'Path to maiker.config.yaml')
    .action(async (opts: { runId?: string; follow?: boolean; raw?: boolean; config?: string }) => {
      const config = loadConfig(opts.config);

      if (!opts.raw) {
        banner();
      }

      try {
        const run = opts.runId
          ? await findRun(opts.runId, config.artifacts.outputDir)
          : await getLatestRun(config.artifacts.outputDir);

        if (!run) {
          fail('No run found. Specify --run-id or start a run first.');
          process.exit(1);
        }

        if (!opts.raw) {
          console.log(`  ${chalk.gray('Run:')} ${run.runId}`);
          console.log(`  ${chalk.gray('Goal:')} ${run.goal}`);
          if (opts.follow) {
            console.log(`  ${chalk.gray('Following log in real time. Press Ctrl+C to stop.')}`);
          }
          console.log('');
        }

        const stream = streamRunEvents(
          run.runId,
          config.artifacts.outputDir,
          opts.follow ?? false,
        );

        for await (const evt of stream) {
          if (opts.raw) {
            console.log(JSON.stringify(evt));
          } else {
            renderEvent(evt);
          }
        }

        if (!opts.follow && !opts.raw) {
          console.log('');
          console.log(chalk.gray('  End of log. Use --follow to tail in real time.'));
          console.log('');
        }

      } catch (err) {
        fail(String(err));
        process.exit(1);
      }
    });
}

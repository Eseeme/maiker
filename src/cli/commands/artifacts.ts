import { Command } from 'commander';
import { banner, section, fail, table } from '../output/index.js';
import { loadConfig } from '../../config/index.js';
import { findRun, getLatestRun } from '../../core/state/index.js';
import { listArtifacts } from '../../artifacts/index.js';
import { basename } from 'path';
import chalk from 'chalk';

export function createArtifactsCommand(): Command {
  const artifacts = new Command('artifacts')
    .description('Manage run artifacts');

  artifacts
    .command('list')
    .description('List artifacts from a run')
    .option('--run-id <id>', 'Run ID')
    .option('--category <name>', 'Filter by category (screenshots, traces, logs, diffs, reports)')
    .option('--config <path>', 'Path to maiker.config.yaml')
    .action(async (opts: { runId?: string; category?: string; config?: string }) => {
      const config = loadConfig(opts.config);
      banner();

      try {
        const run = opts.runId
          ? await findRun(opts.runId, config.artifacts.outputDir)
          : await getLatestRun(config.artifacts.outputDir);

        if (!run) {
          fail('No run found. Specify --run-id');
          process.exit(1);
        }

        const files = await listArtifacts(
          run.runId,
          opts.category as 'screenshots' | 'traces' | 'logs' | 'diffs' | 'reports' | undefined,
          config.artifacts.outputDir,
        );

        if (files.length === 0) {
          console.log(chalk.gray('  No artifacts found'));
          return;
        }

        section(`Artifacts for ${run.runId}`);
        table(
          ['File', 'Path'],
          files.map(f => [basename(f), f]),
        );
        console.log('');
      } catch (err) {
        fail(String(err));
        process.exit(1);
      }
    });

  return artifacts;
}

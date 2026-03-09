import { Command } from 'commander';
import { banner, success, fail } from '../output/index.js';
import { loadConfig } from '../../config/index.js';
import { findRun, getLatestRun, setStatus } from '../../core/state/index.js';
import { emitRunPaused } from '../../artifacts/events.js';

export function createPauseCommand(): Command {
  return new Command('pause')
    .description('Pause a running workflow')
    .option('--run-id <id>', 'Run ID to pause')
    .option('--config <path>', 'Path to maiker.config.yaml')
    .action(async (opts: { runId?: string; config?: string }) => {
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

        if (run.status !== 'running') {
          fail(`Run is not running (current status: ${run.status})`);
          process.exit(1);
        }

        await setStatus(run.runId, 'paused', config.artifacts.outputDir);
        emitRunPaused(run.runId);
        success(`Run ${run.runId} paused`);
        console.log('  Resume with: maiker resume --run-id ' + run.runId);
        console.log('');
      } catch (err) {
        fail(String(err));
        process.exit(1);
      }
    });
}

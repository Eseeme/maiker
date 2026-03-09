import { Command } from 'commander';
import chalk from 'chalk';
import { banner, success, fail } from '../output/index.js';
import { loadConfig } from '../../config/index.js';
import { findRun, getLatestRun, setStatus } from '../../core/state/index.js';
import { emitRunResumed } from '../../artifacts/events.js';
import { runWorkflow } from '../../core/orchestrator/index.js';

export function createResumeCommand(): Command {
  return new Command('resume')
    .description('Resume a paused or blocked workflow')
    .option('--run-id <id>', 'Run ID to resume')
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

        if (run.status !== 'paused' && run.status !== 'blocked') {
          fail(`Run is not paused or blocked (current status: ${run.status})`);
          process.exit(1);
        }

        await setStatus(run.runId, 'running', config.artifacts.outputDir);
        emitRunResumed(run.runId);
        success(`Run ${run.runId} resumed`);
        console.log('');

        // Re-invoke the workflow from the current stage
        console.log(chalk.gray(`  Resuming from stage: ${run.currentStage}`));
        await runWorkflow({
          runId: run.runId,
          goal: run.goal,
          projectPath: run.projectPath,
          config,
        });

      } catch (err) {
        fail(String(err));
        process.exit(1);
      }
    });
}

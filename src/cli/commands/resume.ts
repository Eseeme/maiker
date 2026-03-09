import { Command } from 'commander';
import readline from 'readline';
import chalk from 'chalk';
import { banner, success, fail, info } from '../output/index.js';
import { loadConfig } from '../../config/index.js';
import { findRun, getLatestRun, setStatus } from '../../core/state/index.js';
import { emitRunResumed } from '../../artifacts/events.js';
import { resumeWorkflow } from '../../core/orchestrator/index.js';

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

export function createResumeCommand(): Command {
  return new Command('resume')
    .description('Resume a paused or blocked workflow')
    .option('--run-id <id>', 'Run ID to resume')
    .option('--decision <decision>', 'Human decision: proceed | replan | abort')
    .option('--config <path>', 'Path to maiker.config.yaml')
    .action(async (opts: { runId?: string; decision?: string; config?: string }) => {
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

        // Get human decision
        let decision = opts.decision as 'proceed' | 'replan' | 'abort' | undefined;

        if (!decision && run.status === 'blocked' && process.stdin.isTTY) {
          console.log(chalk.bold('  The run is blocked and needs a human decision.\n'));
          info('Review the escalation packet in .maiker/runs/<id>/review/human-review.md\n');
          console.log('  Options:');
          console.log(`    ${chalk.cyan('proceed')}  — continue from where it stopped`);
          console.log(`    ${chalk.cyan('replan')}   — go back to PLAN and try a different approach`);
          console.log(`    ${chalk.cyan('abort')}    — stop the run\n`);

          const answer = await ask('  Decision [proceed/replan/abort]: ');
          if (['proceed', 'replan', 'abort'].includes(answer)) {
            decision = answer as 'proceed' | 'replan' | 'abort';
          } else {
            decision = 'proceed';
            info('Defaulting to "proceed"');
          }
        }

        decision = decision ?? 'proceed';

        await setStatus(run.runId, 'running', config.artifacts.outputDir);
        emitRunResumed(run.runId);
        success(`Run ${run.runId} resumed with decision: ${decision}`);
        console.log('');

        // Resume the LangGraph workflow from its checkpoint
        console.log(chalk.gray(`  Resuming from stage: ${run.currentStage}`));
        await resumeWorkflow(run.runId, decision, config);

      } catch (err) {
        fail(String(err));
        process.exit(1);
      }
    });
}

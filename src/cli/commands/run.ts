import { Command } from 'commander';
import { resolve } from 'path';
import chalk from 'chalk';
import { banner, success, fail, info } from '../output/index.js';
import { loadConfig } from '../../config/index.js';
import { runWorkflow } from '../../core/orchestrator/index.js';
import { generateRunId } from '../../core/state/index.js';
import { eventBus } from '../../artifacts/events.js';
import { renderEvent } from '../output/index.js';
import { showPreflight } from '../preflight.js';
import type { MaikerEvent } from '../../types/index.js';

export function createRunCommand(): Command {
  return new Command('run')
    .description('Run the full mAIker workflow on a repository')
    .argument('<path>', 'Path to the repository')
    .option('--goal <text>', 'The engineering goal to achieve')
    .option('--config <path>', 'Path to maiker.config.yaml')
    .option('--run-id <id>', 'Resume or reuse a specific run ID')
    .option('--from-last-run', 'Resume from the last run')
    .option('--dry-run', 'Plan only, do not execute changes')
    .option('--yes', 'Skip the pre-flight confirmation prompt')
    .option('--verbose', 'Show verbose event output')
    .option('--max-retries <n>', 'Override maximum repair retries', parseInt)
    .action(async (repoPath: string, opts: {
      goal?: string;
      config?: string;
      runId?: string;
      fromLastRun?: boolean;
      dryRun?: boolean;
      yes?: boolean;
      verbose?: boolean;
      maxRetries?: number;
    }) => {
      const absPath = resolve(repoPath);
      const config = loadConfig(opts.config);

      if (opts.maxRetries !== undefined) {
        config.policies.maxAutoRepairsPerRun = opts.maxRetries;
      }

      banner();

      if (!opts.goal) {
        fail('--goal is required. Example: maiker run ./app --goal "Make dashboard mobile responsive"');
        process.exit(1);
      }

      const runId = opts.runId ?? generateRunId();

      // ── Pre-flight confirmation ─────────────────────────────────────────────
      if (!opts.yes) {
        const confirmed = await showPreflight({
          goal: opts.goal,
          projectPath: absPath,
          config,
          runId,
        });

        if (!confirmed) {
          console.log('');
          console.log(chalk.gray('  Cancelled. Edit maiker.config.yaml to change models, then re-run.'));
          console.log('');
          process.exit(0);
        }
      }

      // ── Run header ─────────────────────────────────────────────────────────
      console.log('');
      console.log(chalk.bold('  Starting run'));
      console.log(chalk.gray('  ────────────────────────────────────────'));
      console.log(`  Run ID:  ${chalk.cyan(runId)}`);
      console.log(`  Project: ${absPath}`);
      console.log(`  Goal:    ${opts.goal}`);
      console.log('');

      if (opts.dryRun) {
        info('Dry run — plan only, no code changes will be made');
      }

      // ── Live event output ──────────────────────────────────────────────────
      eventBus.on('maiker:event', (evt: MaikerEvent) => {
        if (opts.verbose) {
          renderEvent(evt);
        } else {
          switch (evt.type) {
            case 'stage_started':
              console.log(`\n  ${chalk.cyan('→')} ${chalk.bold(evt.stage ?? '')}`);
              break;
            case 'agent_invoked':
              console.log(`  ${chalk.magenta('⚡')} ${evt.agent}  ${chalk.gray(String(evt.data?.model ?? ''))}`);
              break;
            case 'validator_passed':
              console.log(`  ${chalk.green('✓')} ${evt.tool}`);
              break;
            case 'validator_failed':
              console.log(`  ${chalk.red('✗')} ${evt.tool}  ${chalk.gray(`(${evt.data?.issueCount ?? 0} issues)`)}`);
              break;
            case 'issue_created':
              console.log(`  ${chalk.yellow('!')} issue ${evt.issueId}  [${evt.severity}]`);
              break;
            case 'repair_started':
              console.log(`  ${chalk.yellow('⟳')} repair attempt ${evt.data?.attempt}`);
              break;
            case 'escalation_triggered':
              console.log(`  ${chalk.red('⚠')} escalation: ${evt.message}`);
              break;
          }
        }
      });

      // ── Execute ────────────────────────────────────────────────────────────
      try {
        const finalState = await runWorkflow({
          runId,
          goal: opts.goal,
          projectPath: absPath,
          config,
          flags: { configPath: opts.config ?? 'maiker.config.yaml', dryRun: opts.dryRun },
        });

        console.log('');
        console.log(chalk.gray('  ────────────────────────────────────────'));

        if (finalState.stage === 'DONE') {
          success('Run completed');
          console.log(`  Results: ${config.artifacts.outputDir}/${runId}/`);
        } else if (finalState.stage === 'BLOCKED') {
          console.log(`  ${chalk.yellow('⚠')} Human review required`);
          console.log(`  Packet:  ${config.artifacts.outputDir}/${runId}/review/human-review.md`);
          console.log(`  Resume:  maiker resume --run-id ${runId}`);
        } else if (finalState.stage === 'FAILED') {
          fail(`Run failed: ${finalState.error ?? 'Unknown error'}`);
          process.exit(1);
        }

        console.log('');
        console.log(`  ${chalk.gray('Logs:')}    maiker logs --run-id ${runId}`);
        console.log(`  ${chalk.gray('Status:')}  maiker status --run-id ${runId}`);
        console.log('');

      } catch (err) {
        fail(`Run failed: ${String(err)}`);
        process.exit(1);
      }
    });
}

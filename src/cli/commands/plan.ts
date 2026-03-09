import { Command } from 'commander';
import { resolve } from 'path';
import ora from 'ora';
import { banner, section, success, fail, info } from '../output/index.js';
import { inspectRepo, classifyTask } from '../../core/classification/index.js';
import { loadConfig } from '../../config/index.js';
import { runResearchAgent } from '../../agents/research/index.js';
import { runPlannerAgent, buildFallbackPlan } from '../../agents/planner/index.js';
import { getValidationProfile } from '../../core/policies/index.js';
import { summariseRepo } from '../../tools/filesystem/index.js';
import chalk from 'chalk';

export function createPlanCommand(): Command {
  return new Command('plan')
    .description('Generate an execution plan for a given goal without running it')
    .argument('<path>', 'Path to the repository')
    .option('--goal <text>', 'The goal to plan for')
    .option('--config <path>', 'Path to maiker.config.yaml')
    .option('--json', 'Output as JSON')
    .action(async (repoPath: string, opts: { goal?: string; config?: string; json?: boolean }) => {
      const absPath = resolve(repoPath);
      const config = loadConfig(opts.config);

      if (!opts.json) {
        banner();
      }

      const goal = opts.goal ?? 'Analyse the repository and suggest improvements';

      const spinner = opts.json ? null : ora('Inspecting repository...').start();

      try {
        const inspection = await inspectRepo(absPath);
        if (spinner) spinner.text = 'Classifying task...';
        const classification = classifyTask(goal);

        let plan = buildFallbackPlan(goal, classification);

        try {
          if (spinner) spinner.text = 'Running planner agent...';
          const repoSummary = await summariseRepo(absPath);
          const brief = await runResearchAgent(
            { runId: 'plan-preview', goal, projectPath: absPath, repoSummary },
            config,
          );
          const plannerOutput = await runPlannerAgent(
            { runId: 'plan-preview', goal, projectPath: absPath, brief, inspection },
            config,
          );
          plan = plannerOutput.plan;
        } catch {
          // Fallback to heuristic plan
        }

        plan.validationProfile = getValidationProfile(classification);
        spinner?.succeed('Plan generated');

        if (opts.json) {
          console.log(JSON.stringify({ classification, plan }, null, 2));
          return;
        }

        section('Task Classification');
        console.log(`  Task type:   ${chalk.cyan(classification.taskType)}`);
        console.log(`  Risk level:  ${chalk.yellow(classification.riskLevel)}`);
        console.log(`  Complexity:  ${classification.estimatedComplexity}`);

        section('Subtasks');
        for (const sub of plan.subtasks) {
          console.log(`\n  ${chalk.bold(`${sub.order}. ${sub.title}`)}`);
          console.log(`     ${chalk.gray(sub.description)}`);
          if (sub.fileTargets.length > 0) {
            console.log(`     Files: ${sub.fileTargets.join(', ')}`);
          }
        }

        section('Validation Profile');
        info(`Required: ${plan.validationProfile.required.join(', ')}`);
        if (plan.validationProfile.optional.length > 0) {
          console.log(`  Optional: ${chalk.gray(plan.validationProfile.optional.join(', '))}`);
        }
        if (plan.validationProfile.skipped.length > 0) {
          console.log(`  Skipped:  ${chalk.gray(plan.validationProfile.skipped.join(', '))}`);
        }

        if (plan.riskList.length > 0) {
          section('Risks');
          for (const r of plan.riskList) console.log(`  ${chalk.yellow('⚠')} ${r}`);
        }

        console.log('');
        success('Plan ready. Run with: maiker run ' + repoPath + ' --goal "' + goal + '"');
      } catch (err) {
        spinner?.fail('Plan failed');
        fail(String(err));
        process.exit(1);
      }
    });
}

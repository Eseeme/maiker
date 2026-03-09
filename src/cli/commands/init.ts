import { Command } from 'commander';
import fs from 'fs-extra';
import { resolve } from 'path';
import ora from 'ora';
import chalk from 'chalk';
import readline from 'readline';
import { banner, success, info, warn, fail } from '../output/index.js';
import {
  detectAvailableProviders,
  recommendModels,
  getKnownProviders,
  getRoleLabel,
  explainChoice,
  validateProviderKey,
} from '../../core/models/index.js';
import type { AgentRole } from '../../core/models/index.js';
import type { ModelConfig } from '../../types/index.js';

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export function createInitCommand(): Command {
  return new Command('init')
    .description('Bootstrap mAIker in the current project (.maiker/ directory and config)')
    .option('--force', 'Overwrite existing configuration')
    .option('--skip-setup', 'Skip interactive model selection')
    .action(async (opts: { force?: boolean; skipSetup?: boolean }) => {
      banner();
      console.log(chalk.bold('  Initialising mAIker...\n'));

      const spinner = ora('Setting up .maiker/ directory').start();

      try {
        // Create run directory
        const runsDir = resolve('.maiker/runs');
        await fs.ensureDir(runsDir);
        spinner.succeed('.maiker/runs directory created');

        // ── Interactive Model Selection ────────────────────────────────
        let modelRouting: Record<AgentRole, ModelConfig> | undefined;

        if (!opts.skipSetup && process.stdin.isTTY) {
          console.log('');
          console.log(chalk.bold('  Model Setup'));
          console.log(chalk.gray('  ────────────────────────────────────────'));
          console.log('');

          // Detect which API keys are already set
          const providers = detectAvailableProviders();
          const knownProviders = getKnownProviders();

          console.log(chalk.bold('  Detected API keys:\n'));
          for (const p of providers) {
            const status = p.available
              ? chalk.green('✓ found')
              : chalk.gray('✗ not set');
            console.log(`    ${p.provider.padEnd(10)} ${p.envVar.padEnd(22)} ${status}`);
          }
          console.log('');

          // Ask which providers to enable
          const availableNames = providers.filter(p => p.available).map(p => p.provider);

          if (availableNames.length === 0) {
            console.log(chalk.yellow('  No API keys detected in environment.'));
            console.log(chalk.gray('  Set at least one key in .env and re-run maiker init.\n'));
            console.log(chalk.gray(`  Providers: ${knownProviders.join(', ')}`));
            console.log(chalk.gray('  Env vars:  ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY\n'));

            const addNow = await ask('  Add a provider now? Enter provider name or press Enter to skip: ');
            if (addNow && knownProviders.includes(addNow)) {
              availableNames.push(addNow);
              console.log(chalk.yellow(`\n  Remember to set the API key for ${addNow} in .env before running.\n`));
            } else if (addNow) {
              console.log(chalk.gray(`  Unknown provider "${addNow}". Using claude as default.\n`));
              availableNames.push('claude');
            } else {
              availableNames.push('claude');
              console.log(chalk.gray('  Defaulting to claude. Set ANTHROPIC_API_KEY in .env.\n'));
            }
          }

          // Validate detected keys
          const validProviders: string[] = [];
          for (const name of availableNames) {
            const p = providers.find(pr => pr.provider === name);
            if (p?.available) {
              const valSpinner = ora(`  Validating ${name} key...`).start();
              const result = await validateProviderKey(name);
              if (result.valid) {
                valSpinner.succeed(`  ${name} key is valid`);
                validProviders.push(name);
              } else {
                valSpinner.warn(`  ${name} key failed: ${result.error}`);
                const useAnyway = await ask(`  Use ${name} anyway? [y/N] `);
                if (useAnyway.toLowerCase() === 'y') validProviders.push(name);
              }
            } else {
              // Key not in env but user wants to use it later
              validProviders.push(name);
            }
          }

          const finalProviders = validProviders.length > 0 ? validProviders : ['claude'];

          // Get recommendations
          modelRouting = recommendModels(finalProviders);
          console.log('');
          console.log(chalk.bold('  Recommended model routing:\n'));

          const roles = Object.keys(modelRouting) as AgentRole[];
          for (const role of roles) {
            const model = modelRouting[role];
            const reason = explainChoice(model, role);
            const providerColor = model.provider === 'claude' ? chalk.magenta
              : model.provider === 'openai' ? chalk.green
              : model.provider === 'gemini' ? chalk.blue
              : chalk.gray;
            console.log(
              `    ${getRoleLabel(role).padEnd(24)} ${providerColor(model.provider.padEnd(10))} ${model.model.padEnd(24)} ${chalk.gray(`(${reason})`)}`,
            );
          }
          console.log('');

          const confirm = await ask('  Use these models? [Y/n] ');
          if (confirm.toLowerCase() === 'n') {
            console.log(chalk.gray('  You can edit maiker.config.yaml manually after init.\n'));
            modelRouting = undefined;
          }
        }

        // ── Write Config ──────────────────────────────────────────────
        const configDest = resolve('maiker.config.yaml');
        const configExists = await fs.pathExists(configDest);

        if (!configExists || opts.force) {
          const spinner2 = ora('Writing maiker.config.yaml').start();
          const configContent = generateConfig(modelRouting);
          await fs.writeFile(configDest, configContent);
          spinner2.succeed('maiker.config.yaml written');
        } else {
          info('maiker.config.yaml already exists (use --force to overwrite)');
        }

        // Check .env
        const envExists = await fs.pathExists(resolve('.env'));
        if (!envExists) {
          warn('No .env file found. Create one with your API keys.');
        } else {
          success('.env file detected');
        }

        console.log('');
        success('mAIker initialised!');
        console.log('');
        console.log(chalk.gray('  Next steps:'));
        console.log(chalk.gray('  1. Set API keys in .env (if not done yet)'));
        console.log(chalk.gray('  2. Run: maiker inspect .'));
        console.log(chalk.gray('  3. Run: maiker run . --goal "your goal"'));
        console.log('');
      } catch (err) {
        spinner.fail('Initialisation failed');
        fail(String(err));
        process.exit(1);
      }
    });
}

function generateConfig(models?: Record<AgentRole, ModelConfig>): string {
  const m = models ?? {
    researchIngestion:  { provider: 'claude', model: 'claude-sonnet-4-6' },
    planner:            { provider: 'claude', model: 'claude-sonnet-4-6' },
    codeGeneration:     { provider: 'claude', model: 'claude-sonnet-4-6' },
    repairAgent:        { provider: 'claude', model: 'claude-sonnet-4-6' },
    visualReview:       { provider: 'claude', model: 'claude-sonnet-4-6' },
    postApprovalReview: { provider: 'claude', model: 'claude-sonnet-4-6' },
  };

  return `# mAIker Configuration
# Generated by: maiker init
# Docs: https://github.com/your-org/maiker#configuration-reference

project:
  name: my-project
  root: .
  framework: auto
  package_manager: auto

# ─── Agent Model Routing ──────────────────────────────────────────────────────
# Each role is independently configurable. Mix and match providers freely.
# Built-in providers: claude | openai | gemini | pi-mono
# Models are auto-selected based on your available API keys.
# To change: edit provider + model for any role, then run: maiker run --goal "..."
# The pre-flight screen will show you the final routing before execution.
models:
  research_ingestion:
    provider: ${m.researchIngestion.provider}
    model: ${m.researchIngestion.model}
  planner:
    provider: ${m.planner.provider}
    model: ${m.planner.model}
  code_generation:
    provider: ${m.codeGeneration.provider}
    model: ${m.codeGeneration.model}
  repair_agent:
    provider: ${m.repairAgent.provider}
    model: ${m.repairAgent.model}
  visual_review:
    provider: ${m.visualReview.provider}
    model: ${m.visualReview.model}
  post_approval_review:
    provider: ${m.postApprovalReview.provider}
    model: ${m.postApprovalReview.model}

validators:
  install: true
  build: true
  lint: true
  typecheck: true
  unit_tests: true
  integration_tests: false
  playwright_e2e: true
  screenshot_capture: true
  visual_review: true
  ux_rules: true
  accessibility: false
  lockfile_sanity: false
  regression_tests: false
  mobile_layout_rules: false

playwright:
  base_url: http://localhost:3000
  viewports:
    - [320, 568]
    - [375, 667]
    - [390, 844]
    - [768, 1024]
  routes:
    - /
    - /dashboard

policies:
  require_human_approval: true
  post_approval_review_required: true
  max_auto_repairs_per_issue: 3
  max_auto_repairs_per_run: 6
  max_visual_retries: 2
  stop_on_build_failure: false

artifacts:
  output_dir: .maiker/runs
  save_screenshots: true
  save_playwright_trace: true
  save_diff_reports: true
`;
}

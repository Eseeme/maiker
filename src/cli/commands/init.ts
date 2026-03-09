import { Command } from 'commander';
import fs from 'fs-extra';
import { join, resolve } from 'path';
import ora from 'ora';
import chalk from 'chalk';
import { banner, success, info, warn, fail } from '../output/index.js';

export function createInitCommand(): Command {
  return new Command('init')
    .description('Bootstrap mAIker in the current project (.maiker/ directory and config)')
    .option('--force', 'Overwrite existing configuration')
    .action(async (opts: { force?: boolean }) => {
      banner();
      console.log(chalk.bold('  Initialising mAIker...\n'));

      const spinner = ora('Setting up .maiker/ directory').start();

      try {
        // Create run directory
        const runsDir = resolve('.maiker/runs');
        await fs.ensureDir(runsDir);
        spinner.succeed('.maiker/runs directory created');

        // Copy example config if not exists
        const configDest = resolve('maiker.config.yaml');
        const configExists = await fs.pathExists(configDest);

        if (!configExists || opts.force) {
          const spinner2 = ora('Writing maiker.config.yaml').start();
          const templatePath = new URL(
            '../../../templates/maiker.config.yaml',
            import.meta.url,
          );
          const templateExists = await fs.pathExists(templatePath.pathname);

          if (templateExists) {
            await fs.copy(templatePath.pathname, configDest, { overwrite: true });
          } else {
            // Write embedded default
            await fs.writeFile(configDest, DEFAULT_CONFIG_YAML);
          }
          spinner2.succeed('maiker.config.yaml written');
        } else {
          info('maiker.config.yaml already exists (use --force to overwrite)');
        }

        // Check .env
        const envExists = await fs.pathExists(resolve('.env'));
        if (!envExists) {
          const envExamplePath = resolve('.env.example');
          if (await fs.pathExists(envExamplePath)) {
            warn('.env file not found. Copy .env.example to .env and add your API keys.');
          } else {
            warn('No .env file found. Create one with ANTHROPIC_API_KEY etc.');
          }
        } else {
          success('.env file detected');
        }

        console.log('');
        success('mAIker initialised successfully!');
        console.log('');
        console.log(chalk.gray('  Next steps:'));
        console.log(chalk.gray('  1. Edit maiker.config.yaml with your project settings'));
        console.log(chalk.gray('  2. Add API keys to .env'));
        console.log(chalk.gray('  3. Run: maiker inspect ./your-project'));
        console.log('');
      } catch (err) {
        spinner.fail('Initialisation failed');
        fail(String(err));
        process.exit(1);
      }
    });
}

const DEFAULT_CONFIG_YAML = `project:
  name: my-project
  root: .
  framework: auto
  package_manager: auto

models:
  research_ingestion:
    provider: gemini
    model: gemini-2.5-pro
  planner:
    provider: openai
    model: gpt-4o
  code_generation:
    provider: claude
    model: claude-sonnet-4-6
  repair_agent:
    provider: claude
    model: claude-sonnet-4-6
  visual_review:
    provider: openai
    model: gpt-4o
  post_approval_review:
    provider: claude
    model: claude-sonnet-4-6

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

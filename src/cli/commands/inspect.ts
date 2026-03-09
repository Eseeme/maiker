import { Command } from 'commander';
import { resolve } from 'path';
import ora from 'ora';
import { banner, section, success, fail, table } from '../output/index.js';
import { inspectRepo } from '../../core/classification/index.js';
import chalk from 'chalk';

export function createInspectCommand(): Command {
  return new Command('inspect')
    .description('Scan a repository and detect framework, tools, routes, and hotspots')
    .argument('<path>', 'Path to the repository to inspect')
    .option('--json', 'Output as JSON')
    .action(async (repoPath: string, opts: { json?: boolean }) => {
      const absPath = resolve(repoPath);

      if (!opts.json) {
        banner();
        console.log(chalk.bold(`  Inspecting: ${absPath}\n`));
      }

      const spinner = opts.json ? null : ora('Scanning repository...').start();

      try {
        const inspection = await inspectRepo(absPath);
        spinner?.succeed('Repository scanned');

        if (opts.json) {
          console.log(JSON.stringify(inspection, null, 2));
          return;
        }

        section('Repository Summary');
        table(
          ['Field', 'Value'],
          [
            ['Framework', inspection.framework],
            ['Package Manager', inspection.packageManager],
            ['Test Framework', inspection.testFramework],
            ['TypeScript', inspection.hasTypeScript ? 'yes' : 'no'],
            ['Linting', inspection.hasLinting ? 'yes' : 'no'],
            ['Playwright', inspection.hasPlaywright ? 'yes' : 'no'],
          ],
        );

        if (inspection.routes.length > 0) {
          section('Routes Detected');
          for (const route of inspection.routes) {
            console.log(`  ${chalk.cyan('•')} ${route}`);
          }
        }

        if (inspection.hotspots.length > 0) {
          section('Hotspots');
          for (const h of inspection.hotspots) {
            console.log(`  ${chalk.yellow('•')} ${h}`);
          }
        }

        if (inspection.entryPoints.length > 0) {
          section('Entry Points');
          for (const ep of inspection.entryPoints) {
            console.log(`  ${chalk.gray('•')} ${ep}`);
          }
        }

        if (Object.keys(inspection.scripts).length > 0) {
          section('Available Scripts');
          for (const [name, cmd] of Object.entries(inspection.scripts)) {
            console.log(`  ${chalk.bold(name.padEnd(20))} ${chalk.gray(cmd)}`);
          }
        }

        console.log('');
        success('Inspection complete');
      } catch (err) {
        spinner?.fail('Inspection failed');
        fail(String(err));
        process.exit(1);
      }
    });
}

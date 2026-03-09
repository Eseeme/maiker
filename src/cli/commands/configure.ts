import { Command } from 'commander';
import fs from 'fs-extra';
import { resolve } from 'path';
import yaml from 'js-yaml';
import { banner, success, info, section } from '../output/index.js';
import chalk from 'chalk';

export function createConfigureCommand(): Command {
  return new Command('configure')
    .description('Show or edit maiker.config.yaml')
    .option('--show', 'Print current configuration')
    .option('--set <key=value>', 'Set a configuration value (dot notation)')
    .action(async (opts: { show?: boolean; set?: string }) => {
      banner();

      const configPath = resolve('maiker.config.yaml');
      const exists = await fs.pathExists(configPath);

      if (!exists) {
        console.log(chalk.yellow('  No maiker.config.yaml found. Run: maiker init'));
        return;
      }

      if (opts.show || (!opts.set)) {
        const raw = await fs.readFile(configPath, 'utf-8');
        section('Current Configuration');
        console.log('');
        const lines = raw.split('\n');
        for (const line of lines) {
          if (line.match(/^\w/)) {
            console.log(chalk.cyan(`  ${line}`));
          } else if (line.includes(':')) {
            const [key, ...val] = line.split(':');
            console.log(`  ${chalk.gray(key + ':')}${val.join(':')}`);
          } else {
            console.log(`  ${line}`);
          }
        }
        console.log('');
        info(`Config path: ${configPath}`);
        return;
      }

      if (opts.set) {
        const [keyPath, value] = opts.set.split('=');
        if (!keyPath || value === undefined) {
          console.log(chalk.red('  Invalid format. Use: --set key.path=value'));
          return;
        }

        const raw = await fs.readFile(configPath, 'utf-8');
        const parsed = yaml.load(raw) as Record<string, unknown>;
        setNestedValue(parsed, keyPath.split('.'), value);
        await fs.writeFile(configPath, yaml.dump(parsed));
        success(`Set ${keyPath} = ${value}`);
      }
    });
}

function setNestedValue(
  obj: Record<string, unknown>,
  keys: string[],
  value: string,
): void {
  if (keys.length === 1) {
    obj[keys[0]] = value;
    return;
  }
  const key = keys[0];
  if (!obj[key] || typeof obj[key] !== 'object') {
    obj[key] = {};
  }
  setNestedValue(obj[key] as Record<string, unknown>, keys.slice(1), value);
}

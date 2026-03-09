import type {
  ValidatorName,
  ValidatorResult,
  MaikerConfig,
} from '../../types/index.js';
import { runBuild, runLint, runTypecheck, runTests, installDependencies } from '../../tools/package/index.js';
import { emitValidatorStarted, emitValidatorPassed, emitValidatorFailed } from '../../artifacts/events.js';

export interface DeterministicRunOptions {
  runId: string;
  projectPath: string;
  validators: ValidatorName[];
  config: MaikerConfig;
  onOutput?: (line: string) => void;
}

export async function runDeterministicValidators(
  opts: DeterministicRunOptions,
): Promise<ValidatorResult[]> {
  const { runId, projectPath, validators, config, onOutput } = opts;
  const pm = config.project.packageManager === 'auto'
    ? (await import('../../tools/package/index.js').then(m => m.detectPackageManager(projectPath)))
    : config.project.packageManager as 'npm' | 'yarn' | 'pnpm' | 'bun';

  const results: ValidatorResult[] = [];

  for (const validator of validators) {
    if (!isDeterministicValidator(validator)) continue;

    emitValidatorStarted(runId, validator);

    const result = await runSingleValidator(validator, projectPath, pm, onOutput);
    results.push(result);

    if (result.status === 'passed') {
      emitValidatorPassed(runId, validator);
    } else if (result.status === 'failed') {
      emitValidatorFailed(runId, validator, 1);
      if (validator === 'build' && config.policies.stopOnBuildFailure) {
        break;
      }
    }
  }

  return results;
}

async function runSingleValidator(
  validator: ValidatorName,
  cwd: string,
  pm: 'npm' | 'yarn' | 'pnpm' | 'bun' | 'unknown',
  onOutput?: (line: string) => void,
): Promise<ValidatorResult> {
  const start = Date.now();

  try {
    switch (validator) {
      case 'install': {
        const r = await installDependencies(cwd, pm, onOutput);
        return {
          name: validator,
          status: r.success ? 'passed' : 'failed',
          duration: Date.now() - start,
          output: r.output,
          error: r.success ? undefined : r.output,
        };
      }
      case 'build': {
        const r = await runBuild(cwd, pm, onOutput);
        return {
          name: validator,
          status: r.success ? 'passed' : 'failed',
          duration: r.duration,
          output: r.output,
          error: r.success ? undefined : r.output,
        };
      }
      case 'lint': {
        const r = await runLint(cwd, pm, onOutput);
        return {
          name: validator,
          status: r.success ? 'passed' : 'failed',
          duration: r.duration,
          output: r.output,
          error: r.success ? undefined : r.output,
        };
      }
      case 'typecheck': {
        const r = await runTypecheck(cwd, pm, onOutput);
        return {
          name: validator,
          status: r.success ? 'passed' : 'failed',
          duration: r.duration,
          output: r.output,
          error: r.success ? undefined : r.output,
        };
      }
      case 'unit_tests':
      case 'integration_tests':
      case 'regression_tests': {
        const r = await runTests(cwd, pm, onOutput);
        return {
          name: validator,
          status: r.success ? 'passed' : 'failed',
          duration: r.duration,
          output: r.output,
          error: r.success ? undefined : r.output,
        };
      }
      case 'lockfile_sanity': {
        const { runCommand } = await import('../../tools/shell/index.js');
        const r = await runCommand(pm === 'unknown' ? 'npm' : pm, ['ls', '--depth=0'], { cwd, timeout: 30_000 });
        return {
          name: validator,
          status: r.exitCode === 0 ? 'passed' : 'failed',
          duration: Date.now() - start,
          output: r.stdout,
          error: r.exitCode !== 0 ? r.stderr : undefined,
        };
      }
      default:
        return {
          name: validator,
          status: 'skipped',
          duration: 0,
        };
    }
  } catch (err) {
    return {
      name: validator,
      status: 'failed',
      duration: Date.now() - start,
      error: String(err),
    };
  }
}

function isDeterministicValidator(v: ValidatorName): boolean {
  return [
    'install',
    'build',
    'lint',
    'typecheck',
    'unit_tests',
    'integration_tests',
    'regression_tests',
    'lockfile_sanity',
  ].includes(v);
}

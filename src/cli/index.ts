import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createInitCommand } from './commands/init.js';
import { createConfigureCommand } from './commands/configure.js';
import { createInspectCommand } from './commands/inspect.js';
import { createPlanCommand } from './commands/plan.js';
import { createRunCommand } from './commands/run.js';
import { createValidateCommand } from './commands/validate.js';
import { createRepairCommand } from './commands/repair.js';
import { createReviewCommand } from './commands/review.js';
import { createStatusCommand } from './commands/status.js';
import { createLogsCommand } from './commands/logs.js';
import { createPauseCommand } from './commands/pause.js';
import { createResumeCommand } from './commands/resume.js';
import { createContextCommand } from './commands/context.js';
import { createArtifactsCommand } from './commands/artifacts.js';
import { createAuthCommand } from './commands/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getVersion(): string {
  try {
    // Walk up to find package.json
    const pkgPath = join(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };
    return pkg.version;
  } catch {
    return '0.1.0';
  }
}

export function createCLI(): Command {
  const program = new Command();

  program
    .name('maiker')
    .description('mAIker — AI-powered product engineering CLI')
    .version(getVersion(), '-v, --version')
    .addHelpText('after', `
Examples:
  $ maiker init
  $ maiker auth                          # check API keys & OAuth status
  $ maiker auth --validate               # test API connectivity
  $ maiker run ./app --goal "Make dashboard mobile responsive"
  $ maiker status                        # show latest run status
  $ maiker status --all                  # list all runs
  $ maiker logs --follow
  $ maiker context add --message "Do not modify desktop nav"
    `);

  // Register all commands
  program.addCommand(createInitCommand());
  program.addCommand(createConfigureCommand());
  program.addCommand(createInspectCommand());
  program.addCommand(createPlanCommand());
  program.addCommand(createRunCommand());
  program.addCommand(createValidateCommand());
  program.addCommand(createRepairCommand());
  program.addCommand(createReviewCommand());
  program.addCommand(createStatusCommand());
  program.addCommand(createLogsCommand());
  program.addCommand(createPauseCommand());
  program.addCommand(createResumeCommand());
  program.addCommand(createContextCommand());
  program.addCommand(createArtifactsCommand());
  program.addCommand(createAuthCommand());

  // Error handling
  program.exitOverride();

  return program;
}

export async function runCLI(argv: string[] = process.argv): Promise<void> {
  // Load .env if present
  try {
    const { config } = await import('dotenv');
    config();
  } catch { /* dotenv is optional */ }

  // Auto-detect Claude Code OAuth token (macOS Keychain or Linux JSON file)
  // Always prefer a fresh OAuth token over a stale one from .env
  const { applyOAuthToken } = await import('./oauth.js');
  applyOAuthToken();

  const program = createCLI();

  try {
    await program.parseAsync(argv);
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err) {
      const code = (err as { code: string }).code;
      if (code === 'commander.helpDisplayed' || code === 'commander.version') {
        process.exit(0);
      }
    }
    console.error((err as Error).message ?? String(err));
    process.exit(1);
  }
}

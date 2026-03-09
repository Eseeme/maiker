import { runCommand } from '../shell/index.js';

export interface GitStatus {
  branch: string;
  modified: string[];
  untracked: string[];
  staged: string[];
  clean: boolean;
}

export async function getGitStatus(cwd: string): Promise<GitStatus> {
  const branchResult = await runCommand('git', ['branch', '--show-current'], { cwd });
  const branch = branchResult.stdout.trim();

  const statusResult = await runCommand('git', ['status', '--porcelain'], { cwd });
  const lines = statusResult.stdout.split('\n').filter(Boolean);

  const modified: string[] = [];
  const untracked: string[] = [];
  const staged: string[] = [];

  for (const line of lines) {
    const xy = line.slice(0, 2);
    const file = line.slice(3).trim();
    if (xy[0] !== ' ' && xy[0] !== '?') staged.push(file);
    if (xy[1] === 'M') modified.push(file);
    if (xy === '??') untracked.push(file);
  }

  return {
    branch,
    modified,
    untracked,
    staged,
    clean: lines.length === 0,
  };
}

export async function getDiff(cwd: string, ref?: string): Promise<string> {
  const args = ref
    ? ['diff', ref, '--stat']
    : ['diff', '--stat'];
  const result = await runCommand('git', args, { cwd });
  return result.stdout;
}

export async function getFullDiff(cwd: string, ref?: string): Promise<string> {
  const args = ref ? ['diff', ref] : ['diff'];
  const result = await runCommand('git', args, { cwd });
  return result.stdout;
}

export async function createWorktree(
  repoPath: string,
  branch: string,
  targetPath: string,
): Promise<string> {
  await runCommand('git', ['worktree', 'add', '-b', branch, targetPath], {
    cwd: repoPath,
  });
  return targetPath;
}

export async function removeWorktree(
  repoPath: string,
  targetPath: string,
): Promise<void> {
  await runCommand('git', ['worktree', 'remove', '--force', targetPath], {
    cwd: repoPath,
  });
}

export async function stageAll(cwd: string): Promise<void> {
  await runCommand('git', ['add', '-A'], { cwd });
}

export async function commit(cwd: string, message: string): Promise<string> {
  const result = await runCommand('git', ['commit', '-m', message], { cwd });
  return result.stdout;
}

export async function getCurrentCommit(cwd: string): Promise<string> {
  const result = await runCommand('git', ['rev-parse', 'HEAD'], { cwd });
  return result.stdout.trim();
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  const result = await runCommand('git', ['rev-parse', '--git-dir'], { cwd });
  return result.exitCode === 0;
}

// ─── Git Checkpoints for Rollback ────────────────────────────────────────────

/** Create a lightweight tag as a checkpoint before making changes */
export async function createCheckpoint(
  cwd: string,
  label: string,
): Promise<string> {
  // Stage everything and create a checkpoint commit on a detached ref
  const status = await getGitStatus(cwd);
  if (!status.clean) {
    await stageAll(cwd);
    await commit(cwd, `[maiker-checkpoint] ${label}`);
  }
  const ref = await getCurrentCommit(cwd);
  await runCommand('git', ['tag', '-f', `maiker-checkpoint/${label}`, ref], { cwd });
  return ref;
}

/** Rollback to a previously created checkpoint */
export async function rollbackToCheckpoint(
  cwd: string,
  label: string,
): Promise<void> {
  await runCommand('git', ['reset', '--hard', `maiker-checkpoint/${label}`], { cwd });
}

/** Remove a checkpoint tag after successful completion */
export async function removeCheckpoint(
  cwd: string,
  label: string,
): Promise<void> {
  await runCommand('git', ['tag', '-d', `maiker-checkpoint/${label}`], { cwd });
}

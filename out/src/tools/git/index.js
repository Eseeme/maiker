import { runCommand } from '../shell/index.js';
export async function getGitStatus(cwd) {
    const branchResult = await runCommand('git', ['branch', '--show-current'], { cwd });
    const branch = branchResult.stdout.trim();
    const statusResult = await runCommand('git', ['status', '--porcelain'], { cwd });
    const lines = statusResult.stdout.split('\n').filter(Boolean);
    const modified = [];
    const untracked = [];
    const staged = [];
    for (const line of lines) {
        const xy = line.slice(0, 2);
        const file = line.slice(3).trim();
        if (xy[0] !== ' ' && xy[0] !== '?')
            staged.push(file);
        if (xy[1] === 'M')
            modified.push(file);
        if (xy === '??')
            untracked.push(file);
    }
    return {
        branch,
        modified,
        untracked,
        staged,
        clean: lines.length === 0,
    };
}
export async function getDiff(cwd, ref) {
    const args = ref
        ? ['diff', ref, '--stat']
        : ['diff', '--stat'];
    const result = await runCommand('git', args, { cwd });
    return result.stdout;
}
export async function getFullDiff(cwd, ref) {
    const args = ref ? ['diff', ref] : ['diff'];
    const result = await runCommand('git', args, { cwd });
    return result.stdout;
}
export async function createWorktree(repoPath, branch, targetPath) {
    await runCommand('git', ['worktree', 'add', '-b', branch, targetPath], {
        cwd: repoPath,
    });
    return targetPath;
}
export async function removeWorktree(repoPath, targetPath) {
    await runCommand('git', ['worktree', 'remove', '--force', targetPath], {
        cwd: repoPath,
    });
}
export async function stageAll(cwd) {
    await runCommand('git', ['add', '-A'], { cwd });
}
export async function commit(cwd, message) {
    const result = await runCommand('git', ['commit', '-m', message], { cwd });
    return result.stdout;
}
export async function getCurrentCommit(cwd) {
    const result = await runCommand('git', ['rev-parse', 'HEAD'], { cwd });
    return result.stdout.trim();
}
export async function isGitRepo(cwd) {
    const result = await runCommand('git', ['rev-parse', '--git-dir'], { cwd });
    return result.exitCode === 0;
}
// ─── Git Checkpoints for Rollback ────────────────────────────────────────────
/** Create a lightweight tag as a checkpoint before making changes */
export async function createCheckpoint(cwd, label) {
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
export async function rollbackToCheckpoint(cwd, label) {
    await runCommand('git', ['reset', '--hard', `maiker-checkpoint/${label}`], { cwd });
}
/** Remove a checkpoint tag after successful completion */
export async function removeCheckpoint(cwd, label) {
    await runCommand('git', ['tag', '-d', `maiker-checkpoint/${label}`], { cwd });
}
//# sourceMappingURL=index.js.map
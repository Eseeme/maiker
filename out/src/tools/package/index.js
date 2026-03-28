import { spawnCommand } from '../shell/index.js';
export async function detectPackageManager(cwd) {
    const fs = await import('fs-extra');
    const { join } = await import('path');
    if (await fs.default.pathExists(join(cwd, 'bun.lockb')))
        return 'bun';
    if (await fs.default.pathExists(join(cwd, 'pnpm-lock.yaml')))
        return 'pnpm';
    if (await fs.default.pathExists(join(cwd, 'yarn.lock')))
        return 'yarn';
    if (await fs.default.pathExists(join(cwd, 'package-lock.json')))
        return 'npm';
    return 'npm';
}
export function getPmCommand(pm) {
    return pm === 'unknown' ? 'npm' : pm;
}
export async function installDependencies(cwd, pm, onOutput) {
    const cmd = getPmCommand(pm);
    const result = await spawnCommand(cmd, ['install'], {
        cwd,
        onStdout: onOutput,
        onStderr: onOutput,
        timeout: 180_000,
    });
    return {
        success: result.exitCode === 0,
        output: result.stdout + result.stderr,
    };
}
export async function runScript(cwd, pm, script, onOutput) {
    const cmd = getPmCommand(pm);
    const result = await spawnCommand(cmd, ['run', script], {
        cwd,
        onStdout: onOutput,
        onStderr: onOutput,
        timeout: 300_000,
    });
    return {
        success: result.exitCode === 0,
        output: result.stdout + result.stderr,
        duration: result.duration,
    };
}
export async function runBuild(cwd, pm, onOutput) {
    return runScript(cwd, pm, 'build', onOutput);
}
export async function runLint(cwd, pm, onOutput) {
    // Try 'lint' script first, then 'eslint'
    const pkg = await import('fs-extra');
    const { join } = await import('path');
    let pkgJson = {};
    try {
        pkgJson = await pkg.default.readJson(join(cwd, 'package.json'));
    }
    catch { /* ignore */ }
    if (pkgJson.scripts?.lint) {
        return runScript(cwd, pm, 'lint', onOutput);
    }
    // Fallback to direct eslint
    const cmd = getPmCommand(pm);
    const result = await spawnCommand(cmd, ['exec', 'eslint', '.', '--ext', '.ts,.tsx,.js,.jsx'], {
        cwd,
        onStdout: onOutput,
        onStderr: onOutput,
        timeout: 120_000,
    });
    return { success: result.exitCode === 0, output: result.stdout + result.stderr, duration: result.duration };
}
export async function runTypecheck(cwd, pm, onOutput) {
    const pkg = await import('fs-extra');
    const { join } = await import('path');
    let pkgJson = {};
    try {
        pkgJson = await pkg.default.readJson(join(cwd, 'package.json'));
    }
    catch { /* ignore */ }
    if (pkgJson.scripts?.typecheck) {
        return runScript(cwd, pm, 'typecheck', onOutput);
    }
    const cmd = getPmCommand(pm);
    const result = await spawnCommand(cmd, ['exec', 'tsc', '--noEmit'], {
        cwd,
        onStdout: onOutput,
        onStderr: onOutput,
        timeout: 120_000,
    });
    return { success: result.exitCode === 0, output: result.stdout + result.stderr, duration: result.duration };
}
export async function runTests(cwd, pm, onOutput) {
    return runScript(cwd, pm, 'test', onOutput);
}
//# sourceMappingURL=index.js.map
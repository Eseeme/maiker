import fs from 'fs-extra';
import { join } from 'path';
import { glob } from 'glob';
export async function readFile(filePath) {
    return fs.readFile(filePath, 'utf-8');
}
export async function writeFile(filePath, content) {
    await fs.ensureDir(join(filePath, '..'));
    await fs.writeFile(filePath, content, 'utf-8');
}
export async function fileExists(filePath) {
    return fs.pathExists(filePath);
}
export async function listFiles(dir, pattern = '**/*', ignore = ['**/node_modules/**', '**/.git/**', '**/dist/**']) {
    const files = await glob(pattern, {
        cwd: dir,
        ignore,
        nodir: true,
    });
    return files.map((f) => join(dir, f));
}
export async function findFiles(dir, extensions, ignore = ['node_modules', '.git', 'dist', '.next']) {
    const patterns = extensions.map((e) => `**/*${e}`);
    const results = [];
    for (const pattern of patterns) {
        const files = await glob(pattern, {
            cwd: dir,
            ignore: ignore.map((i) => `**/${i}/**`),
            nodir: true,
        });
        results.push(...files.map((f) => join(dir, f)));
    }
    return [...new Set(results)];
}
export async function readDirectory(dir) {
    if (!(await fs.pathExists(dir)))
        return [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.map((e) => e.name);
}
export async function summariseRepo(rootPath) {
    const lines = [];
    // package.json
    const pkgPath = join(rootPath, 'package.json');
    if (await fs.pathExists(pkgPath)) {
        const pkg = await fs.readJson(pkgPath);
        lines.push(`Package: ${pkg.name ?? 'unknown'} v${pkg.version ?? '?'}`);
        if (pkg.scripts) {
            lines.push(`Scripts: ${Object.keys(pkg.scripts).join(', ')}`);
        }
        if (pkg.dependencies) {
            lines.push(`Dependencies: ${Object.keys(pkg.dependencies).slice(0, 20).join(', ')}`);
        }
    }
    // Directory tree (shallow)
    const topLevel = await readDirectory(rootPath);
    lines.push(`Root files/dirs: ${topLevel.join(', ')}`);
    // Source files count
    const srcFiles = await findFiles(rootPath, ['.ts', '.tsx', '.js', '.jsx']);
    lines.push(`Source files: ${srcFiles.length}`);
    const cssFiles = await findFiles(rootPath, ['.css', '.scss', '.module.css']);
    lines.push(`Style files: ${cssFiles.length}`);
    return lines.join('\n');
}
//# sourceMappingURL=index.js.map
import fs from 'fs-extra';
import { join, relative, resolve } from 'path';
import { glob } from 'glob';

export async function readFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf-8');
}

export async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.ensureDir(join(filePath, '..'));
  await fs.writeFile(filePath, content, 'utf-8');
}

export async function fileExists(filePath: string): Promise<boolean> {
  return fs.pathExists(filePath);
}

export async function listFiles(
  dir: string,
  pattern = '**/*',
  ignore: string[] = ['**/node_modules/**', '**/.git/**', '**/dist/**'],
): Promise<string[]> {
  const files = await glob(pattern, {
    cwd: dir,
    ignore,
    nodir: true,
  });
  return files.map((f) => join(dir, f));
}

export async function findFiles(
  dir: string,
  extensions: string[],
  ignore: string[] = ['node_modules', '.git', 'dist', '.next'],
): Promise<string[]> {
  const patterns = extensions.map((e) => `**/*${e}`);
  const results: string[] = [];
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

export async function readDirectory(dir: string): Promise<string[]> {
  if (!(await fs.pathExists(dir))) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries.map((e) => e.name);
}

export async function summariseRepo(rootPath: string): Promise<string> {
  const lines: string[] = [];

  // package.json
  const pkgPath = join(rootPath, 'package.json');
  if (await fs.pathExists(pkgPath)) {
    const pkg = await fs.readJson(pkgPath) as {
      name?: string;
      version?: string;
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
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

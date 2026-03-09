import { runCommand } from '../shell/index.js';
import fs from 'fs-extra';
import { join } from 'path';

export async function generateDiff(
  cwd: string,
  fromRef?: string,
): Promise<string> {
  const args = fromRef ? ['diff', fromRef, '--stat', '-p'] : ['diff', '--stat', '-p'];
  const result = await runCommand('git', args, { cwd });
  return result.stdout;
}

export async function summariseDiff(diffContent: string): Promise<{
  addedLines: number;
  removedLines: number;
  changedFiles: string[];
}> {
  const lines = diffContent.split('\n');
  let addedLines = 0;
  let removedLines = 0;
  const changedFiles: string[] = [];

  for (const line of lines) {
    if (line.startsWith('+++ b/')) {
      changedFiles.push(line.slice(6));
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      addedLines++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      removedLines++;
    }
  }

  return { addedLines, removedLines, changedFiles };
}

export async function saveDiffReport(
  runDir: string,
  diffContent: string,
  label: string,
): Promise<string> {
  const diffDir = join(runDir, 'artifacts', 'diffs');
  await fs.ensureDir(diffDir);
  const filename = `${label}-${Date.now()}.diff`;
  const path = join(diffDir, filename);
  await fs.writeFile(path, diffContent);
  return path;
}

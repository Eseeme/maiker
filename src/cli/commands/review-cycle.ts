import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import { banner, success, fail, info } from '../output/index.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ReviewConfig {
  urls: string[];
  compareWith: 'latest' | 'snapshot' | 'none';
  schedule: string; // cron expression
  autoApply: boolean;
  categories: string[];
}

interface Finding {
  id: string;
  category: string;
  title: string;
  description: string;
  impact: 'low' | 'medium' | 'high' | 'critical';
  recommendation: string;
  status: 'pending' | 'approved' | 'rejected' | 'deferred';
  source: string;
  detectedAt: string;
  appliedAt?: string;
}

interface ReviewSnapshot {
  id: string;
  createdAt: string;
  urls: string[];
  findings: Finding[];
  summary: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const REVIEWS_DIR = '.maiker/reviews';
const CONFIG_FILE = '.maiker/reviews/review-config.yaml';
const CHANGELOG_FILE = '.maiker/reviews/changelog.md';
const BACKLOG_FILE = '.maiker/reviews/backlog.md';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getReviewsDir(): string {
  const dir = resolve(process.cwd(), REVIEWS_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function getSnapshotId(): string {
  const now = new Date();
  return now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function createSnapshotDir(id: string): string {
  const dir = join(getReviewsDir(), id);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function getLatestReviewDir(): string | null {
  const base = getReviewsDir();
  const dirs = readdirSync(base, { withFileTypes: true })
    .filter(d => d.isDirectory() && /^\d{4}-\d{2}/.test(d.name))
    .sort((a, b) => b.name.localeCompare(a.name));
  return dirs.length > 0 ? join(base, dirs[0].name) : null;
}

function ensureReviewConfig(): void {
  const configPath = resolve(process.cwd(), CONFIG_FILE);
  if (!existsSync(configPath)) {
    const dir = resolve(process.cwd(), REVIEWS_DIR);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    writeFileSync(configPath, `# mAIker Periodic Review Configuration
# Edit this file to configure what gets reviewed and when.

urls:
  - https://your-product.com
  - https://your-product.com/dashboard

# How to compare: 'latest' compares with previous snapshot, 'none' skips comparison
compare_with: latest

# Cron schedule for automated reviews (default: weekly Monday 9am)
schedule: "0 9 * * 1"

# Auto-apply low-risk findings without human review
auto_apply: false

# Categories to check
categories:
  - ui_changes        # Visual/layout changes detected
  - new_features      # New functionality on the site
  - broken_links      # Dead links or 404s
  - performance       # Load time regressions
  - accessibility     # a11y issues
  - seo              # Meta tags, structured data
  - security         # Exposed endpoints, headers
  - architecture     # Suggests maiker architecture updates
  - dependencies     # Outdated or vulnerable deps
`);
  }
}

function ensureChangelog(): void {
  const path = resolve(process.cwd(), CHANGELOG_FILE);
  if (!existsSync(path)) {
    writeFileSync(path, `# mAIker Review Changelog

> Running log of all findings applied from periodic reviews.

---

`);
  }
}

function ensureBacklog(): void {
  const path = resolve(process.cwd(), BACKLOG_FILE);
  if (!existsSync(path)) {
    writeFileSync(path, `# mAIker Review Backlog

> Deferred findings awaiting future review cycles.

---

`);
  }
}

// ─── Command ─────────────────────────────────────────────────────────────────

export function createReviewCycleCommand(): Command {
  const cmd = new Command('review-cycle')
    .description('Periodic review: collect, analyze, triage, and apply findings to maiker');

  // ── maiker review-cycle run ────────────────────────────────────────────────
  cmd
    .command('run')
    .description('Run a new review cycle: collect data, analyze, generate findings')
    .option('--url <urls...>', 'URLs to review (overrides config)')
    .option('--compare-with <mode>', 'Comparison mode: latest, snapshot, none', 'latest')
    .option('--dry-run', 'Analyze but do not save results')
    .action(async (opts: { url?: string[]; compareWith?: string; dryRun?: boolean }) => {
      banner();
      console.log(chalk.bold('  Periodic Review — Collect & Analyze'));
      console.log(chalk.gray('  ────────────────────────────────────────'));
      console.log('');

      ensureReviewConfig();
      ensureChangelog();
      ensureBacklog();

      const snapshotId = getSnapshotId();
      const snapshotDir = opts.dryRun ? null : createSnapshotDir(snapshotId);

      // Determine URLs
      const urls = opts.url ?? ['(configured in review-config.yaml)'];
      console.log(`    ${chalk.gray('Review ID:')}  ${snapshotId}`);
      console.log(`    ${chalk.gray('URLs:')}       ${urls.join(', ')}`);
      console.log(`    ${chalk.gray('Compare:')}    ${opts.compareWith}`);
      console.log('');

      // ── Step 1: Collect ──────────────────────────────────────────────
      console.log(chalk.bold('  Step 1: Collecting data...'));
      console.log('');

      const snapshot: ReviewSnapshot = {
        id: snapshotId,
        createdAt: new Date().toISOString(),
        urls,
        findings: [],
        summary: '',
      };

      // Save snapshot placeholder
      if (snapshotDir) {
        writeFileSync(
          join(snapshotDir, 'snapshot.json'),
          JSON.stringify(snapshot, null, 2),
        );
        console.log(`    ${chalk.green('✓')} Snapshot saved to ${snapshotDir}/snapshot.json`);
      }

      // ── Step 2: Generate findings template ───────────────────────────
      console.log('');
      console.log(chalk.bold('  Step 2: Generating findings template...'));
      console.log('');

      const findingsTemplate = `# Review Findings — ${snapshotId}

> Generated: ${new Date().toISOString()}
> URLs reviewed: ${urls.join(', ')}
> Compare mode: ${opts.compareWith}

---

## How to use this file

1. Run this review with an AI agent (Claude Code, maiker research agent) to populate findings
2. Each finding has a status: \`pending\` → human reviews → \`approved\` / \`rejected\` / \`deferred\`
3. Run \`maiker review-cycle apply\` to apply approved findings

---

## Findings

<!-- Add findings below. Each finding follows this format: -->

### [PENDING] Finding Title

- **Category:** ui_changes | new_features | architecture | dependencies | security | ...
- **Impact:** low | medium | high | critical
- **Source:** URL or description of where this was detected
- **Recommendation:** What should change in maiker or the target project

Description of the finding...

---

## Architecture Recommendations

<!-- Suggestions for updating maiker itself -->

### [PENDING] Recommendation Title

- **Impact:** How this affects maiker's ability to handle projects
- **Effort:** low | medium | high
- **Recommendation:** Specific changes to maiker code, config, or agents

---

## Summary

<!-- AI-generated summary goes here after analysis -->
`;

      if (snapshotDir) {
        writeFileSync(join(snapshotDir, 'findings.md'), findingsTemplate);
        console.log(`    ${chalk.green('✓')} Findings template: ${snapshotDir}/findings.md`);

        // Architecture delta template
        const archDelta = `# Architecture Delta — ${snapshotId}

> Suggested changes to maiker based on this review cycle.
> Edit this file, then run: maiker review-cycle apply

## Proposed Changes

| # | Area | Change | Impact | Status |
|---|------|--------|--------|--------|
| 1 | — | — | — | pending |

## Detail

### 1. Change Title

**Current state:** ...
**Proposed:** ...
**Why:** ...
**Files to modify:** ...
`;

        writeFileSync(join(snapshotDir, 'architecture-delta.md'), archDelta);
        console.log(`    ${chalk.green('✓')} Architecture delta: ${snapshotDir}/architecture-delta.md`);

        // Decision template
        const decision = `# Human Decision — ${snapshotId}

> Review each finding and mark your decision.
> Then run: maiker review-cycle apply

## Decisions

<!-- Copy findings here and mark: APPROVED / REJECTED / DEFERRED -->

| # | Finding | Decision | Notes |
|---|---------|----------|-------|
| 1 | — | pending | — |
`;

        writeFileSync(join(snapshotDir, 'decision.md'), decision);
        console.log(`    ${chalk.green('✓')} Decision template: ${snapshotDir}/decision.md`);
      }

      console.log('');
      console.log(chalk.gray('  ────────────────────────────────────────'));
      console.log('');

      if (snapshotDir) {
        success('Review cycle created');
        console.log('');
        info('Next steps:');
        console.log(`    1. Use an AI agent to populate ${chalk.cyan('findings.md')} with actual analysis`);
        console.log(`    2. Review findings and fill in ${chalk.cyan('decision.md')}`);
        console.log(`    3. Run ${chalk.cyan('maiker review-cycle apply')} to apply approved changes`);
      } else {
        info('Dry run complete — no files saved');
      }
      console.log('');
    });

  // ── maiker review-cycle status ─────────────────────────────────────────────
  cmd
    .command('status')
    .description('Show status of review cycles and pending findings')
    .option('--filter <status>', 'Filter by status: pending, approved, rejected, deferred')
    .action((opts: { filter?: string }) => {
      banner();
      console.log(chalk.bold('  Periodic Review — Status'));
      console.log(chalk.gray('  ────────────────────────────────────────'));
      console.log('');

      const reviewsDir = resolve(process.cwd(), REVIEWS_DIR);
      if (!existsSync(reviewsDir)) {
        info('No reviews found. Run: maiker review-cycle run');
        console.log('');
        return;
      }

      const dirs = readdirSync(reviewsDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && /^\d{4}-\d{2}/.test(d.name))
        .sort((a, b) => b.name.localeCompare(a.name));

      if (dirs.length === 0) {
        info('No review cycles found. Run: maiker review-cycle run');
        console.log('');
        return;
      }

      for (const d of dirs.slice(0, 10)) {
        const dirPath = join(reviewsDir, d.name);
        const hasFindings = existsSync(join(dirPath, 'findings.md'));
        const hasDecision = existsSync(join(dirPath, 'decision.md'));
        const hasApplied = existsSync(join(dirPath, 'applied.md'));

        let status = 'created';
        if (hasApplied) status = 'applied';
        else if (hasDecision) status = 'awaiting-apply';
        else if (hasFindings) status = 'awaiting-review';

        const statusColor = {
          'created': chalk.gray,
          'awaiting-review': chalk.yellow,
          'awaiting-apply': chalk.cyan,
          'applied': chalk.green,
        }[status] ?? chalk.gray;

        console.log(`    ${statusColor('●')} ${d.name}  ${statusColor(status)}`);
      }

      if (dirs.length > 10) {
        console.log(chalk.gray(`    ... and ${dirs.length - 10} more`));
      }

      console.log('');
    });

  // ── maiker review-cycle apply ──────────────────────────────────────────────
  cmd
    .command('apply')
    .description('Apply approved findings from the latest review cycle')
    .option('--review <id>', 'Specific review cycle ID to apply')
    .option('--dry-run', 'Show what would be applied without making changes')
    .action((opts: { review?: string; dryRun?: boolean }) => {
      banner();
      console.log(chalk.bold('  Periodic Review — Apply'));
      console.log(chalk.gray('  ────────────────────────────────────────'));
      console.log('');

      let reviewDir: string | null;
      if (opts.review) {
        reviewDir = join(getReviewsDir(), opts.review);
        if (!existsSync(reviewDir)) {
          fail(`Review cycle not found: ${opts.review}`);
          console.log('');
          return;
        }
      } else {
        reviewDir = getLatestReviewDir();
        if (!reviewDir) {
          fail('No review cycles found. Run: maiker review-cycle run');
          console.log('');
          return;
        }
      }

      const decisionPath = join(reviewDir, 'decision.md');
      if (!existsSync(decisionPath)) {
        fail('No decision.md found. Review findings first.');
        console.log('');
        return;
      }

      const decision = readFileSync(decisionPath, 'utf-8');
      const approvedCount = (decision.match(/APPROVED/gi) || []).length;
      const rejectedCount = (decision.match(/REJECTED/gi) || []).length;
      const deferredCount = (decision.match(/DEFERRED/gi) || []).length;

      console.log(`    ${chalk.green('Approved:')}  ${approvedCount}`);
      console.log(`    ${chalk.red('Rejected:')}  ${rejectedCount}`);
      console.log(`    ${chalk.yellow('Deferred:')} ${deferredCount}`);
      console.log('');

      if (approvedCount === 0) {
        info('No approved findings to apply.');
        console.log('');
        return;
      }

      if (opts.dryRun) {
        info(`Dry run: would apply ${approvedCount} finding(s)`);
        console.log('');
        return;
      }

      // Create applied.md
      const appliedContent = `# Applied Findings — ${new Date().toISOString()}

Applied ${approvedCount} approved finding(s) from this review cycle.

## Applied Items

<!-- Details of what was applied -->

## Deferred to Backlog

${deferredCount} finding(s) moved to backlog.
`;

      writeFileSync(join(reviewDir, 'applied.md'), appliedContent);

      // Append to changelog
      ensureChangelog();
      const changelogPath = resolve(process.cwd(), CHANGELOG_FILE);
      const changelogEntry = `\n### ${new Date().toISOString().slice(0, 10)} — Review ${reviewDir.split('/').pop()}\n\n- Applied ${approvedCount} finding(s)\n- Rejected ${rejectedCount}\n- Deferred ${deferredCount}\n\n`;
      const existing = readFileSync(changelogPath, 'utf-8');
      writeFileSync(changelogPath, existing + changelogEntry);

      success(`Applied ${approvedCount} finding(s)`);
      console.log(`    Changelog updated: ${chalk.cyan(CHANGELOG_FILE)}`);
      console.log('');

      info('Next: use maiker to implement the approved changes:');
      console.log(`    ${chalk.cyan('maiker run . --goal "Apply review findings from ' + reviewDir.split('/').pop() + '"')}`);
      console.log('');
    });

  // ── maiker review-cycle init ───────────────────────────────────────────────
  cmd
    .command('init')
    .description('Initialize the review pipeline folder structure and config')
    .action(() => {
      banner();
      console.log(chalk.bold('  Periodic Review — Initialize'));
      console.log(chalk.gray('  ────────────────────────────────────────'));
      console.log('');

      ensureReviewConfig();
      ensureChangelog();
      ensureBacklog();

      success('Review pipeline initialized');
      console.log('');
      console.log(`    ${chalk.green('✓')} ${CONFIG_FILE}`);
      console.log(`    ${chalk.green('✓')} ${CHANGELOG_FILE}`);
      console.log(`    ${chalk.green('✓')} ${BACKLOG_FILE}`);
      console.log('');
      info(`Edit ${chalk.cyan(CONFIG_FILE)} to configure URLs and schedule`);
      console.log(`    Then run: ${chalk.cyan('maiker review-cycle run')}`);
      console.log('');
    });

  return cmd;
}

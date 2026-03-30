/**
 * Secret Scanning Patterns & Entropy Detection
 *
 * Comprehensive regex patterns for detecting secrets in source code,
 * plus Shannon entropy-based detection for unknown token formats.
 */

// ─── Known Secret Patterns ──────────────────────────────────────────────────

export const SECRET_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  // API keys (generic)
  { pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][A-Za-z0-9_\-]{20,}['"]/i, label: 'API key assignment' },

  // AWS
  { pattern: /AKIA[0-9A-Z]{16}/, label: 'AWS access key' },
  { pattern: /(?:aws_secret_access_key|AWS_SECRET)\s*[:=]\s*['"][A-Za-z0-9/+=]{40}['"]/i, label: 'AWS secret key' },

  // Generic tokens/passwords
  { pattern: /(?:secret|token|password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}['"]/i, label: 'Secret/token/password' },

  // Private keys
  { pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/, label: 'Private key' },

  // JWT tokens
  { pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, label: 'JWT token' },

  // GitHub tokens
  { pattern: /gh[ps]_[A-Za-z0-9]{36,}/, label: 'GitHub token' },
  { pattern: /github_pat_[A-Za-z0-9_]{22,}/, label: 'GitHub fine-grained token' },

  // Anthropic keys
  { pattern: /sk-ant-[A-Za-z0-9_-]{20,}/, label: 'Anthropic API key' },

  // OpenAI keys
  { pattern: /sk-[A-Za-z0-9]{20,}T3BlbkFJ/, label: 'OpenAI API key' },

  // Google
  { pattern: /AIza[A-Za-z0-9_-]{35}/, label: 'Google API key' },

  // Stripe
  { pattern: /sk_(?:live|test)_[A-Za-z0-9]{24,}/, label: 'Stripe secret key' },
  { pattern: /pk_(?:live|test)_[A-Za-z0-9]{24,}/, label: 'Stripe publishable key' },

  // Twilio
  { pattern: /SK[0-9a-fA-F]{32}/, label: 'Twilio API key' },
  { pattern: /AC[0-9a-fA-F]{32}/, label: 'Twilio account SID' },

  // SendGrid
  { pattern: /SG\.[A-Za-z0-9_-]{22,}\.[A-Za-z0-9_-]{22,}/, label: 'SendGrid API key' },

  // Slack
  { pattern: /xox[bpras]-[A-Za-z0-9-]{10,}/, label: 'Slack token' },
  { pattern: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/, label: 'Slack webhook URL' },

  // Heroku
  { pattern: /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(?=.*heroku)/i, label: 'Heroku API key' },

  // Mailgun
  { pattern: /key-[A-Za-z0-9]{32}/, label: 'Mailgun API key' },

  // Database connection strings with embedded passwords
  { pattern: /(?:mongodb|postgres|mysql|redis):\/\/[^:]+:[^@]+@/, label: 'Database connection string with password' },

  // Azure
  { pattern: /DefaultEndpointsProtocol=https;AccountName=[^;]+;AccountKey=[A-Za-z0-9+/=]{40,}/, label: 'Azure storage connection string' },

  // Generic Bearer token in code
  { pattern: /['"]Bearer\s+[A-Za-z0-9_\-.]{20,}['"]/, label: 'Hardcoded Bearer token' },

  // npm tokens
  { pattern: /npm_[A-Za-z0-9]{36}/, label: 'npm access token' },

  // Discord
  { pattern: /[MN][A-Za-z\d]{23,}\.[\w-]{6}\.[\w-]{27}/, label: 'Discord bot token' },

  // Firebase
  { pattern: /AAAA[A-Za-z0-9_-]{7}:[A-Za-z0-9_-]{140}/, label: 'Firebase server key' },
];

// ─── Variable Name Hints (for entropy detection) ────────────────────────────

/** Variable names that suggest the value might be a secret */
export const SECRET_VARIABLE_HINTS = /(?:api_?key|secret|token|password|passwd|auth|credential|private_?key|access_?key|signing_?key|encryption_?key)\s*[:=]\s*['"]([^'"]{16,})['"]/gi;

// ─── Shannon Entropy Detection ──────────────────────────────────────────────

export const ENTROPY_THRESHOLD = 4.5; // bits per character

/**
 * Calculate Shannon entropy of a string.
 * High entropy (>4.5) suggests random/cryptographic content — likely a secret.
 * English text is typically 3.5-4.0 bits/char. API keys are typically 5.0-6.0.
 */
export function shannonEntropy(str: string): number {
  if (str.length === 0) return 0;

  const freq = new Map<string, number>();
  for (const ch of str) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }

  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / str.length;
    entropy -= p * Math.log2(p);
  }

  return entropy;
}

/**
 * Check if a string value looks like a high-entropy secret.
 * Used for values assigned to suspicious variable names.
 */
export function isHighEntropySecret(value: string): boolean {
  // Skip values that are clearly not secrets
  if (value.length < 16) return false;
  if (value.length > 500) return false; // Likely a long string, not a key

  // Skip common false positives
  if (/^[a-z]+(-[a-z]+)*$/.test(value)) return false; // kebab-case words
  if (/^[a-z]+(_[a-z]+)*$/.test(value)) return false; // snake_case words
  if (/^(https?|ftp):\/\//.test(value)) return false; // URLs (may have tokens but handled separately)
  if (/^\d+$/.test(value)) return false; // Pure numbers

  return shannonEntropy(value) >= ENTROPY_THRESHOLD;
}

// ─── External Scanner Integration ────────────────────────────────────────────

import { spawnCommand } from '../../tools/shell/index.js';

/**
 * Check if gitleaks is available on the system.
 */
export async function isGitleaksAvailable(): Promise<boolean> {
  try {
    const result = await spawnCommand('gitleaks', ['version'], { timeout: 5000 });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Run gitleaks on specific files (if available).
 * Returns any findings as strings.
 */
export async function runGitleaks(
  projectPath: string,
  changedFiles: string[],
): Promise<string[]> {
  try {
    const available = await isGitleaksAvailable();
    if (!available) return [];

    // Run gitleaks in detect mode on the project
    const result = await spawnCommand(
      'gitleaks',
      ['detect', '--source', projectPath, '--no-git', '--report-format', 'json', '--exit-code', '0'],
      { cwd: projectPath, timeout: 30_000 },
    );

    if (result.stdout.trim()) {
      try {
        const findings = JSON.parse(result.stdout) as Array<{ Description: string; File: string; Secret: string }>;
        // Filter to only changed files
        const changedSet = new Set(changedFiles);
        return findings
          .filter(f => changedSet.has(f.File))
          .map(f => `[gitleaks] ${f.Description} in ${f.File}`);
      } catch {
        return [];
      }
    }
    return [];
  } catch {
    return [];
  }
}

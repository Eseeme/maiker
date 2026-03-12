/**
 * Claude Code OAuth Token Detection
 *
 * Reads the OAuth token from Claude Code credentials.
 * - Linux: ~/.claude/.credentials.json (plain JSON file)
 * - macOS: macOS Keychain via `security` command, falls back to JSON file
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir, platform } from 'os';
import { execSync } from 'child_process';

export interface OAuthResult {
  found: boolean;
  token?: string;
  expiresAt?: number;
  hoursLeft?: number;
  source?: 'keychain' | 'file';
  error?: string;
}

/**
 * Try to read Claude Code OAuth credentials from the macOS Keychain.
 * Claude Code stores credentials under the service name "Claude Code-credentials".
 */
function readFromMacKeychain(): OAuthResult {
  try {
    const raw = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w',
      { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();

    const creds = JSON.parse(raw);
    const token = creds?.claudeAiOauth?.accessToken;
    const expiresAt = creds?.claudeAiOauth?.expiresAt;

    if (token && expiresAt) {
      const hoursLeft = (expiresAt - Date.now()) / (1000 * 60 * 60);
      return {
        found: true,
        token,
        expiresAt,
        hoursLeft,
        source: 'keychain',
      };
    }
    return { found: false, error: 'Token not found in keychain data' };
  } catch {
    return { found: false, error: 'Keychain entry not found' };
  }
}

/**
 * Try to read Claude Code OAuth credentials from the JSON file.
 * Linux and fallback for macOS if keychain fails.
 */
function readFromFile(): OAuthResult {
  try {
    const credsPath = join(homedir(), '.claude', '.credentials.json');
    if (!existsSync(credsPath)) {
      return { found: false, error: 'Credentials file not found' };
    }

    const creds = JSON.parse(readFileSync(credsPath, 'utf-8'));
    const token = creds?.claudeAiOauth?.accessToken;
    const expiresAt = creds?.claudeAiOauth?.expiresAt;

    if (token && expiresAt) {
      const hoursLeft = (expiresAt - Date.now()) / (1000 * 60 * 60);
      return {
        found: true,
        token,
        expiresAt,
        hoursLeft,
        source: 'file',
      };
    }
    return { found: false, error: 'Token not found in credentials file' };
  } catch {
    return { found: false, error: 'Could not read credentials file' };
  }
}

/**
 * Detect Claude Code OAuth token from the best available source.
 * On macOS: tries Keychain first, then falls back to JSON file.
 * On Linux: reads JSON file directly.
 */
export function detectOAuthToken(): OAuthResult {
  if (platform() === 'darwin') {
    // macOS: try keychain first, fall back to file
    const keychainResult = readFromMacKeychain();
    if (keychainResult.found) return keychainResult;
    return readFromFile();
  }

  // Linux / other: JSON file
  return readFromFile();
}

/**
 * Apply OAuth token to process.env if appropriate.
 * Prefers a fresh OAuth token over a stale one from .env.
 */
export function applyOAuthToken(): void {
  const result = detectOAuthToken();
  if (!result.found || !result.token) return;

  // Only use if not expired
  if (result.hoursLeft !== undefined && result.hoursLeft <= 0) return;

  const current = process.env.ANTHROPIC_API_KEY ?? '';
  // Use OAuth token if no key set, or if current key is a stale OAuth token
  if (!current || current.startsWith('sk-ant-oat')) {
    process.env.ANTHROPIC_API_KEY = result.token;
  }
}

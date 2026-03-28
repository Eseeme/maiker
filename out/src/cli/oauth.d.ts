/**
 * Claude Code OAuth Token Detection
 *
 * Reads the OAuth token from Claude Code credentials.
 * - Linux: ~/.claude/.credentials.json (plain JSON file)
 * - macOS: macOS Keychain via `security` command, falls back to JSON file
 */
export interface OAuthResult {
    found: boolean;
    token?: string;
    expiresAt?: number;
    hoursLeft?: number;
    source?: 'keychain' | 'file';
    error?: string;
}
/**
 * Detect Claude Code OAuth token from the best available source.
 * On macOS: tries Keychain first, then falls back to JSON file.
 * On Linux: reads JSON file directly.
 */
export declare function detectOAuthToken(): OAuthResult;
/**
 * Apply OAuth token to process.env if appropriate.
 * Prefers a fresh OAuth token over a stale one from .env.
 */
export declare function applyOAuthToken(): void;
//# sourceMappingURL=oauth.d.ts.map
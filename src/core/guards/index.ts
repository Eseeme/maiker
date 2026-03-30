/**
 * Execution Safety Guards
 *
 * Centralized enforcement layer for:
 *   - Path sandboxing (all file ops stay within project root)
 *   - Command allow/deny lists (block destructive shell commands)
 *   - Sensitive file protection (.env, credentials, keys)
 *   - Write guards for protected paths
 *
 * All tool execution flows through these guards before touching disk.
 */

import { resolve, relative, isAbsolute } from 'path';

// ─── Types ───────────────────────────────────────────────────────────────────

export type SecurityMode = 'safe' | 'workspace' | 'full';

export interface SecurityPolicy {
  /** Controls how restrictive the guards are */
  mode: SecurityMode;
  /** Extra paths (relative to project) that are always blocked for writes */
  protectedFiles: string[];
  /** Extra commands to allow beyond defaults (workspace/full modes only) */
  allowedCommands: string[];
  /** Extra commands to block beyond defaults */
  blockedCommands: string[];
}

export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  mode: 'workspace',
  protectedFiles: [],
  allowedCommands: [],
  blockedCommands: [],
};

// ─── Sensitive File Patterns ─────────────────────────────────────────────────

const SENSITIVE_FILE_PATTERNS = [
  /^\.env($|\.)/,               // .env, .env.local, .env.production
  /\.pem$/,                     // Private keys
  /\.key$/,                     // Key files
  /id_rsa/,                     // SSH keys
  /id_ed25519/,                 // SSH keys
  /credentials\.json$/,         // GCP / generic credentials
  /secrets?\.(json|ya?ml|toml)$/,  // Secrets files
  /\.secret$/,                  // Generic secret files
  /token\.json$/,               // OAuth tokens
  /service[_-]?account.*\.json$/, // GCP service accounts
];

/** Files that should never be read or written by agents */
const ALWAYS_BLOCKED_PATHS = [
  /^\/etc\//,
  /^\/root\//,
  /^\/var\/log\//,
  /^\/usr\//,
  /^\/boot\//,
  /^\/proc\//,
  /^\/sys\//,
  /^~?\/?\.ssh\//,
  /^~?\/?\.gnupg\//,
  /^~?\/?\.aws\/credentials/,
  /^~?\/?\.config\/gcloud/,
];

// ─── Command Deny/Allow Lists ────────────────────────────────────────────────

/** Commands that are always blocked regardless of mode */
const BLOCKED_COMMAND_PATTERNS = [
  // Destructive filesystem ops
  /\brm\s+(-[rRf]+\s+)*\//,         // rm -rf / or rm /
  /\brm\s+(-[rRf]+\s+)*~/,          // rm -rf ~/
  /\brm\s+(-[rRf]+\s+)*\.\.\//,     // rm -rf ../
  /\bmkfs\b/,                        // Format filesystem
  /\bdd\s+.*of=\//,                  // dd to device/root paths
  /\bchmod\s+777\b/,                 // World writable
  /\bchown\b.*\broot\b/,            // Change ownership to root

  // Dangerous git operations
  /\bgit\s+push\s+.*--force\b/,     // Force push
  /\bgit\s+push\s+-f\b/,            // Force push shorthand
  /\bgit\s+reset\s+--hard\s+origin\b/, // Reset to remote (lose local)
  /\bgit\s+clean\s+-[dDfFxX]+/,     // Nuke untracked files

  // Network exfiltration
  /\bcurl\b.*\|\s*sh\b/,            // Pipe curl to shell
  /\bwget\b.*\|\s*sh\b/,            // Pipe wget to shell
  /\bnc\s+-[el]/,                    // Netcat listeners
  /\bscp\b/,                         // Remote copy
  /\brsync\b.*:/,                    // Remote sync

  // Process/system manipulation
  /\bkill\s+-9\s+[01]\b/,           // Kill init/systemd
  /\bkillall\b/,                     // Kill by name
  /\bshutdown\b/,                    // System shutdown
  /\breboot\b/,                      // System reboot
  /\bsudo\b/,                        // Privilege escalation
  /\bsu\s/,                          // Switch user

  // Package-level dangers
  /\bnpm\s+publish\b/,              // Publish to registry
  /\bnpm\s+unpublish\b/,            // Unpublish from registry
  /\bnpm\s+deprecate\b/,            // Deprecate package
];

/** Commands allowed in safe mode (read-only + build/test) */
const SAFE_MODE_ALLOWED = [
  /^(cat|head|tail|less|more)\b/,
  /^ls\b/,
  /^find\b/,
  /^grep\b/,
  /^wc\b/,
  /^file\b/,
  /^stat\b/,
  /^git\s+(status|log|diff|branch|show|rev-parse|describe|tag\s+-l)\b/,
  /^(npm|yarn|pnpm|bun)\s+(run|test|exec)\b/,
  /^npx\b/,
  /^node\b/,
  /^(tsc|tsx)\b/,
  /^echo\b/,
  /^pwd\b/,
  /^which\b/,
  /^env\b/,
];

/** Additional commands allowed in workspace mode (normal development) */
const WORKSPACE_MODE_ALLOWED = [
  /^(npm|yarn|pnpm|bun)\s+(install|add|remove|ci|link|unlink|update|outdated|audit|ls|list|dedupe|prune)\b/,
  /^git\s+(add|commit|stash|checkout|switch|merge|rebase|cherry-pick|fetch|pull|push|worktree|tag(?!\s+-[dD]))\b/,
  /^mkdir\b/,
  /^cp\b/,
  /^mv\b/,
  /^rm\b/,              // rm allowed but checked separately for dangerous patterns
  /^touch\b/,
  /^chmod\b/,           // chmod allowed but checked separately for 777
  /^(prettier|eslint|biome|oxlint)\b/,
  /^(jest|vitest|playwright|cypress)\b/,
  /^docker\s+(build|run|ps|logs|exec|stop|start|compose)\b/,
];

// ─── Path Sandboxing ─────────────────────────────────────────────────────────

export interface PathCheckResult {
  allowed: boolean;
  resolved: string;
  reason?: string;
}

/**
 * Validate that a file path resolves within the project root.
 * Blocks path traversal (../../), absolute escapes, and sensitive files.
 */
export function checkPath(
  inputPath: string,
  projectPath: string,
  operation: 'read' | 'write',
  policy: SecurityPolicy = DEFAULT_SECURITY_POLICY,
): PathCheckResult {
  const resolved = resolve(projectPath, inputPath);
  const rel = relative(projectPath, resolved);

  // Block traversal outside project
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return {
      allowed: false,
      resolved,
      reason: `Path escapes project root: ${inputPath} resolves to ${resolved}`,
    };
  }

  // Block system paths
  for (const pattern of ALWAYS_BLOCKED_PATHS) {
    if (pattern.test(resolved)) {
      return {
        allowed: false,
        resolved,
        reason: `Blocked system path: ${resolved}`,
      };
    }
  }

  // Block sensitive files for writes (reads allowed in workspace/full mode)
  const fileName = resolved.split('/').pop() ?? '';
  const relPath = rel;

  for (const pattern of SENSITIVE_FILE_PATTERNS) {
    if (pattern.test(fileName) || pattern.test(relPath)) {
      if (operation === 'write') {
        return {
          allowed: false,
          resolved,
          reason: `Cannot write to sensitive file: ${relPath}`,
        };
      }
      if (policy.mode === 'safe') {
        return {
          allowed: false,
          resolved,
          reason: `Cannot read sensitive file in safe mode: ${relPath}`,
        };
      }
    }
  }

  // Check user-defined protected files (write-only protection)
  if (operation === 'write') {
    for (const protectedPath of policy.protectedFiles) {
      if (relPath === protectedPath || relPath.startsWith(protectedPath + '/')) {
        return {
          allowed: false,
          resolved,
          reason: `Protected file: ${relPath} (defined in security policy)`,
        };
      }
    }
  }

  return { allowed: true, resolved };
}

// ─── Command Validation ──────────────────────────────────────────────────────

export interface CommandCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Validate a shell command against allow/deny lists.
 * Returns whether the command is safe to execute.
 */
export function checkCommand(
  command: string,
  policy: SecurityPolicy = DEFAULT_SECURITY_POLICY,
): CommandCheckResult {
  const trimmed = command.trim();

  // Always block dangerous commands regardless of mode
  for (const pattern of BLOCKED_COMMAND_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        allowed: false,
        reason: `Blocked dangerous command: ${trimmed.slice(0, 80)}`,
      };
    }
  }

  // Check user-defined blocked commands
  for (const blocked of policy.blockedCommands) {
    if (trimmed.startsWith(blocked) || trimmed.includes(blocked)) {
      return {
        allowed: false,
        reason: `Command blocked by policy: ${blocked}`,
      };
    }
  }

  // In full mode, everything not explicitly blocked is allowed
  if (policy.mode === 'full') {
    return { allowed: true };
  }

  // Check user-defined allowed commands first (applies to safe + workspace)
  for (const allowed of policy.allowedCommands) {
    if (trimmed.startsWith(allowed)) {
      return { allowed: true };
    }
  }

  // Check safe mode allowlist
  for (const pattern of SAFE_MODE_ALLOWED) {
    if (pattern.test(trimmed)) {
      return { allowed: true };
    }
  }

  // Check workspace mode allowlist
  if (policy.mode === 'workspace') {
    for (const pattern of WORKSPACE_MODE_ALLOWED) {
      if (pattern.test(trimmed)) {
        return { allowed: true };
      }
    }
  }

  return {
    allowed: false,
    reason: `Command not in allowlist for '${policy.mode}' mode: ${trimmed.slice(0, 80)}`,
  };
}

// ─── Shell Injection Prevention ──────────────────────────────────────────────

/**
 * Parse a command string into executable + arguments without shell interpretation.
 * Returns the command and args array for use with execFile (no shell: true).
 */
export function parseCommand(command: string): { cmd: string; args: string[] } {
  // Handle common shell patterns safely by routing through sh -c
  // but ONLY for piped/chained commands that need shell interpretation
  const needsShell = /[|&;<>`$()]/.test(command);

  if (needsShell) {
    return { cmd: 'sh', args: ['-c', command] };
  }

  // Simple command: split on whitespace, respecting quotes
  const parts = parseShellArgs(command);
  return { cmd: parts[0], args: parts.slice(1) };
}

/**
 * Basic shell argument parser that handles single and double quotes.
 */
function parseShellArgs(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (ch === ' ' && !inSingle && !inDouble) {
      if (current.length > 0) {
        args.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) {
    args.push(current);
  }
  return args;
}

// ─── Convenience: Full guard check for tool execution ────────────────────────

export interface GuardResult {
  allowed: boolean;
  reason?: string;
  resolved?: string;
}

export function guardFileOp(
  inputPath: string,
  projectPath: string,
  operation: 'read' | 'write',
  policy?: SecurityPolicy,
): GuardResult {
  const result = checkPath(inputPath, projectPath, operation, policy);
  return {
    allowed: result.allowed,
    reason: result.reason,
    resolved: result.resolved,
  };
}

export function guardCommand(
  command: string,
  policy?: SecurityPolicy,
): GuardResult {
  const result = checkCommand(command, policy);
  return {
    allowed: result.allowed,
    reason: result.reason,
  };
}

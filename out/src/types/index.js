// ─── mAIker — Shared Type Definitions ────────────────────────────────────────
export function classifyError(err) {
    const message = String(err);
    const lower = message.toLowerCase();
    // Auth errors — escalate immediately
    if (lower.includes('authentication_error') || lower.includes('invalid x-api-key') ||
        lower.includes('invalid api key') || lower.includes('401') ||
        lower.includes('unauthorized') || lower.includes('permission denied')) {
        return { category: 'auth', message, retryable: false, suggestedAction: 'escalate' };
    }
    // Rate limits and transient errors — auto-retry
    if (lower.includes('rate_limit') || lower.includes('rate limit') ||
        lower.includes('429') || lower.includes('too many requests') ||
        lower.includes('timeout') || lower.includes('etimedout') ||
        lower.includes('econnreset') || lower.includes('econnrefused') ||
        lower.includes('503') || lower.includes('502') ||
        lower.includes('service unavailable') || lower.includes('overloaded')) {
        return { category: 'transient', message, retryable: true, suggestedAction: 'retry' };
    }
    // Resource errors — escalate
    if (lower.includes('out of memory') || lower.includes('enomem') ||
        lower.includes('enospc') || lower.includes('disk full') ||
        lower.includes('heap out of memory')) {
        return { category: 'resource', message, retryable: false, suggestedAction: 'escalate' };
    }
    // Dependency errors — targeted fix
    if (lower.includes('module not found') || lower.includes('cannot find module') ||
        lower.includes('enoent') && lower.includes('package.json') ||
        lower.includes('missing dependency')) {
        return { category: 'dependency', message, retryable: false, suggestedAction: 'repair' };
    }
    // Validation errors — repair loop
    if (lower.includes('build failed') || lower.includes('lint') ||
        lower.includes('typecheck') || lower.includes('test failed') ||
        lower.includes('tsc') || lower.includes('eslint')) {
        return { category: 'validation', message, retryable: false, suggestedAction: 'repair' };
    }
    // Code generation errors — repair
    if (lower.includes('json') && lower.includes('parse') ||
        lower.includes('unexpected token') || lower.includes('syntax error')) {
        return { category: 'code_generation', message, retryable: true, suggestedAction: 'retry' };
    }
    return { category: 'unknown', message, retryable: true, suggestedAction: 'retry' };
}
//# sourceMappingURL=index.js.map
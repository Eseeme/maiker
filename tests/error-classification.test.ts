import { describe, it, expect } from 'vitest';
import { classifyError } from '../src/types/index.js';

describe('classifyError', () => {
  it('classifies auth errors', () => {
    expect(classifyError('authentication_error: invalid x-api-key').category).toBe('auth');
    expect(classifyError('401 Unauthorized').category).toBe('auth');
    expect(classifyError('invalid api key').category).toBe('auth');
    expect(classifyError('Permission denied').category).toBe('auth');
  });

  it('auth errors are not retryable', () => {
    const result = classifyError('authentication_error');
    expect(result.retryable).toBe(false);
    expect(result.suggestedAction).toBe('escalate');
  });

  it('classifies transient errors', () => {
    expect(classifyError('rate_limit_error').category).toBe('transient');
    expect(classifyError('429 Too Many Requests').category).toBe('transient');
    expect(classifyError('Request timeout').category).toBe('transient');
    expect(classifyError('ECONNRESET').category).toBe('transient');
    expect(classifyError('503 Service Unavailable').category).toBe('transient');
    expect(classifyError('overloaded_error').category).toBe('transient');
  });

  it('transient errors are retryable', () => {
    const result = classifyError('rate_limit_error');
    expect(result.retryable).toBe(true);
    expect(result.suggestedAction).toBe('retry');
  });

  it('classifies resource errors', () => {
    expect(classifyError('ENOMEM: out of memory').category).toBe('resource');
    expect(classifyError('ENOSPC: disk full').category).toBe('resource');
    expect(classifyError('JavaScript heap out of memory').category).toBe('resource');
  });

  it('resource errors suggest escalation', () => {
    const result = classifyError('out of memory');
    expect(result.retryable).toBe(false);
    expect(result.suggestedAction).toBe('escalate');
  });

  it('classifies dependency errors', () => {
    expect(classifyError('Module not found: react').category).toBe('dependency');
    expect(classifyError("Cannot find module 'lodash'").category).toBe('dependency');
  });

  it('classifies validation errors', () => {
    expect(classifyError('build failed with exit code 1').category).toBe('validation');
    expect(classifyError('eslint: 5 errors found').category).toBe('validation');
    expect(classifyError('tsc: error TS2304').category).toBe('validation');
  });

  it('classifies code generation errors', () => {
    expect(classifyError('JSON parse error').category).toBe('code_generation');
    expect(classifyError('Unexpected token <').category).toBe('code_generation');
    expect(classifyError('SyntaxError: unexpected token').category).toBe('code_generation');
  });

  it('classifies unknown errors with retry', () => {
    const result = classifyError('something completely unexpected happened');
    expect(result.category).toBe('unknown');
    expect(result.retryable).toBe(true);
    expect(result.suggestedAction).toBe('retry');
  });

  it('handles non-string errors', () => {
    const result = classifyError(new Error('test error'));
    expect(result.message).toContain('test error');
  });

  it('handles null/undefined errors', () => {
    expect(classifyError(null).category).toBe('unknown');
    expect(classifyError(undefined).category).toBe('unknown');
  });
});

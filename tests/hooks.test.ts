import { describe, it, expect } from 'vitest';
import { checkNoTouchZones, scanForSecrets } from '../src/core/hooks/index.js';

describe('checkNoTouchZones', () => {
  const project = '/home/user/myapp';

  it('allows writes outside no-touch zones', () => {
    const result = checkNoTouchZones('src/index.ts', project, ['src/legacy/']);
    expect(result.blocked).toBe(false);
  });

  it('blocks writes inside a no-touch zone directory', () => {
    const result = checkNoTouchZones('src/legacy/old-module.ts', project, ['src/legacy/']);
    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/No-touch zone/);
  });

  it('blocks writes to exact no-touch zone file', () => {
    const result = checkNoTouchZones('package-lock.json', project, ['package-lock.json']);
    expect(result.blocked).toBe(true);
  });

  it('handles multiple no-touch zones', () => {
    const zones = ['src/legacy/', 'vendor/', '.github/'];
    expect(checkNoTouchZones('vendor/lib.js', project, zones).blocked).toBe(true);
    expect(checkNoTouchZones('.github/workflows/ci.yml', project, zones).blocked).toBe(true);
    expect(checkNoTouchZones('src/new/feature.ts', project, zones).blocked).toBe(false);
  });

  it('allows writes when no zones are defined', () => {
    const result = checkNoTouchZones('src/anything.ts', project, []);
    expect(result.blocked).toBe(false);
  });
});

describe('scanForSecrets', () => {
  it('detects API key patterns', () => {
    const content = 'const apiKey = "sk-ant-abc123def456ghi789jklmnopqrstuv"';
    const result = scanForSecrets(content, 'config.ts');
    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/Secret detected/);
  });

  it('detects AWS access keys', () => {
    const content = 'AWS_KEY=AKIAIOSFODNN7EXAMPLE';
    const result = scanForSecrets(content, 'config.ts');
    expect(result.blocked).toBe(true);
  });

  it('detects private keys', () => {
    const content = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow...';
    const result = scanForSecrets(content, 'server.key');
    expect(result.blocked).toBe(true);
  });

  it('detects GitHub tokens', () => {
    const content = 'token: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij"';
    const result = scanForSecrets(content, 'config.ts');
    expect(result.blocked).toBe(true);
  });

  it('allows normal code content', () => {
    const content = `
export function calculateTotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price, 0);
}
`;
    const result = scanForSecrets(content, 'utils.ts');
    expect(result.blocked).toBe(false);
  });

  it('allows password field names without values', () => {
    const content = 'const passwordField = document.getElementById("password");';
    const result = scanForSecrets(content, 'login.ts');
    expect(result.blocked).toBe(false);
  });

  it('skips lock files', () => {
    const content = 'integrity: "sha512-AKIAIOSFODNN7EXAMPLE"';
    const result = scanForSecrets(content, 'package-lock.json');
    expect(result.blocked).toBe(false);
  });

  it('skips SVG files', () => {
    const content = '<svg>ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij</svg>';
    const result = scanForSecrets(content, 'logo.svg');
    expect(result.blocked).toBe(false);
  });

  it('detects JWT tokens', () => {
    const content = 'token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"';
    const result = scanForSecrets(content, 'auth.ts');
    expect(result.blocked).toBe(true);
  });
});

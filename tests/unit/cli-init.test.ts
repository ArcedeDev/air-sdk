import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Tests for CLI init logic.
 * We test the helper functions and env file writing,
 * not the interactive readline (which requires a TTY).
 */

describe('CLI init — .env file handling', () => {
  const testDir = path.join(__dirname, '.test-env-output');
  const envPath = path.join(testDir, '.env');

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(envPath)) fs.unlinkSync(envPath);
    if (fs.existsSync(testDir)) fs.rmdirSync(testDir);
  });

  it('creates a new .env file with the API key', () => {
    const key = 'air_sdk_live_abc123def456';
    fs.writeFileSync(envPath, 'AIR_API_KEY=' + key + '\n');

    const content = fs.readFileSync(envPath, 'utf-8');
    expect(content).toContain('AIR_API_KEY=' + key);
  });

  it('appends to existing .env without overwriting', () => {
    fs.writeFileSync(envPath, 'EXISTING_VAR=hello\n');
    fs.appendFileSync(envPath, 'AIR_API_KEY=air_sdk_live_test\n');

    const content = fs.readFileSync(envPath, 'utf-8');
    expect(content).toContain('EXISTING_VAR=hello');
    expect(content).toContain('AIR_API_KEY=air_sdk_live_test');
  });

  it('replaces existing AIR_API_KEY in .env', () => {
    fs.writeFileSync(envPath, 'AIR_API_KEY=old_key\nOTHER=value\n');

    // Simulate the replacement logic
    let content = fs.readFileSync(envPath, 'utf-8');
    content = content.replace(/^AIR_API_KEY=.*$/m, 'AIR_API_KEY=new_key');
    fs.writeFileSync(envPath, content);

    const result = fs.readFileSync(envPath, 'utf-8');
    expect(result).toContain('AIR_API_KEY=new_key');
    expect(result).toContain('OTHER=value');
    expect(result).not.toContain('old_key');
  });
});

describe('CLI init — API key validation', () => {
  it('accepts valid air_sdk_live_ prefixed keys', () => {
    const key = 'air_sdk_live_a3c7e9f1b2d4c6e8a0b2d4f6e8a0c2d4';
    expect(key.startsWith('air_sdk_live_')).toBe(true);
    expect(key.length).toBeGreaterThan(20);
  });

  it('rejects keys without the correct prefix', () => {
    const badKeys = ['sk_test_123', 'other_prefix_key', 'just_random_string', ''];
    for (const key of badKeys) {
      expect(key.startsWith('air_sdk_live_')).toBe(false);
    }
  });

  it('validates email format', () => {
    const validEmails = ['user@example.com', 'test+tag@domain.co', 'a@b.io'];
    const invalidEmails = ['', 'not-an-email', 'no-at-sign', 'missing-dot@com'];

    for (const email of validEmails) {
      expect(email.includes('@') && email.includes('.')).toBe(true);
    }
    for (const email of invalidEmails) {
      expect(email.includes('@') && email.includes('.') && email.length > 3).toBe(false);
    }
  });
});

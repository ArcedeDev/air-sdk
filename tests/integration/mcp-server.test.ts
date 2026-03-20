import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const SERVER_PATH = resolve(__dirname, '../../src/mcp/server.ts');

describe('MCP Server Integration', () => {
  it('exits with error when AIR_API_KEY is not set', async () => {
    const child = spawn('npx', ['tsx', SERVER_PATH], {
      env: { ...process.env, AIR_API_KEY: '', PATH: process.env.PATH },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    const exitCode = await new Promise<number | null>((resolve) => {
      child.on('exit', (code) => resolve(code));
      setTimeout(() => {
        child.kill('SIGTERM');
        resolve(null);
      }, 5000);
    });

    expect(stderr).toContain('AIR_API_KEY');
    expect(exitCode).toBe(1);
  }, 10_000);

  it('starts successfully with a valid API key (does not exit immediately)', async () => {
    const child = spawn('npx', ['tsx', SERVER_PATH], {
      env: { ...process.env, AIR_API_KEY: 'air_test_integration_key_12345', PATH: process.env.PATH },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // The server should stay alive for at least 1 second (waiting for stdin)
    const exited = await Promise.race([
      new Promise<boolean>((resolve) => {
        child.on('exit', () => resolve(true));
      }),
      new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), 1500);
      }),
    ]);

    // Clean up
    child.kill('SIGTERM');

    // Server should NOT have exited — it should be waiting for MCP input
    expect(exited).toBe(false);
  }, 10_000);
});

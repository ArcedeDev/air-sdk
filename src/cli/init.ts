import * as readline from 'node:readline';
import * as path from 'node:path';
import { SDK_VERSION } from '../version';
import { bold, dim, green, red, yellow, cyan } from './colors';
import {
  resolveApiKey,
  saveCredentials,
  writeDotEnvKey,
  maskKey,
  isValidKeyFormat,
  getCredentialsPath,
  sourceLabel,
} from './config';

const API_BASE = 'https://api.agentinternetruntime.com';
const SIGNUP_URL = 'https://agentinternetruntime.com/extract/signup';
const DASHBOARD_URL = 'https://agentinternetruntime.com/extract/dashboard/sdk';

/** Interactive SDK initialization — guides user through key setup. */
export async function runInit(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise(r => rl.question(q, r));

  console.log('');
  console.log('  ' + bold('AIR SDK Setup') + dim(' (v' + SDK_VERSION + ')'));
  console.log('  ' + dim('─'.repeat(30)));
  console.log('');

  try {
    // --- Check for existing key ---
    const existing = resolveApiKey();
    if (existing) {
      console.log('  Found existing key: ' + dim(maskKey(existing.key)));
      console.log('  Source: ' + dim(sourceLabel(existing.source)));
      const overwrite = await ask('  Overwrite? (y/N): ');
      if (overwrite.toLowerCase() !== 'y') {
        console.log('  Keeping existing key.\n');
        rl.close();
        return;
      }
    }

    // --- Open dashboard in browser ---
    console.log('  Opening your dashboard to generate a key...');
    console.log('');
    try {
      const { exec } = await import('node:child_process');
      const openCmd = process.platform === 'darwin' ? 'open' :
        process.platform === 'win32' ? 'start' : 'xdg-open';
      exec(openCmd + ' ' + DASHBOARD_URL);
    } catch {
      // Browser open is best-effort
    }

    console.log('  1. Sign up or log in at:');
    console.log('     ' + cyan(SIGNUP_URL));
    console.log('');
    console.log('  2. Go to your SDK dashboard:');
    console.log('     ' + cyan(DASHBOARD_URL));
    console.log('');
    console.log('  3. Click "Generate SDK Key" and paste it below.');
    console.log('');

    const key = (await ask('  API Key: ')).trim();

    if (!key) {
      console.error('\n  ' + red('No key provided. Aborting.'));
      rl.close();
      process.exit(1);
    }

    if (!isValidKeyFormat(key)) {
      console.error('\n  ' + red('Invalid key format.') + ' AIR SDK keys start with "air_".');
      console.error('  Get one at: ' + cyan(DASHBOARD_URL));
      rl.close();
      process.exit(1);
    }

    // --- Save to global config (primary) ---
    try {
      saveCredentials(key, 'init');
      console.log('');
      console.log('  ' + green('✓') + ' Saved to ' + dim(getCredentialsPath()) + dim(' (0600)'));
    } catch (err) {
      console.error('  ' + red('✗') + ' Could not save credentials: ' + (err instanceof Error ? err.message : String(err)));
      rl.close();
      process.exit(1);
    }

    // --- Optionally save to .env for programmatic usage ---
    const saveEnv = await ask('  Also save to .env for Playwright/Puppeteer? (Y/n): ');
    if (saveEnv.toLowerCase() !== 'n') {
      try {
        const envPath = path.resolve(process.cwd(), '.env');
        writeDotEnvKey(envPath, key);
        console.log('  ' + green('✓') + ' Saved to ' + dim('.env'));
        console.log(dim('    Make sure .env is in your .gitignore'));
      } catch (err) {
        console.log('  ' + yellow('⚠') + ' ' + (err instanceof Error ? err.message : String(err)));
        console.log('  Add manually: AIR_API_KEY=' + key);
      }
    }

    // --- Verify connectivity ---
    try {
      const verifyRes = await fetch(API_BASE + '/api/v1/sdk/capabilities?domain=example.com', {
        headers: { 'Authorization': 'Bearer ' + key },
      });
      if (verifyRes.ok) {
        console.log('  ' + green('✓') + ' Key verified');
      } else if (verifyRes.status === 401) {
        console.log('  ' + red('✗') + ' Key rejected — check it at ' + cyan(DASHBOARD_URL));
        rl.close();
        process.exit(1);
      } else {
        console.log('  ' + yellow('⚠') + ' API returned ' + verifyRes.status + ' (key saved, may need a moment)');
      }
    } catch {
      console.log('  ' + yellow('⚠') + ' Could not reach API — key saved locally');
    }

    // --- Done ---
    console.log('');
    console.log('  ' + green('You\'re ready.') + ' Free tier: 1,000 executions/month.');
    console.log('');
    console.log('  ' + bold('Next steps:'));
    console.log('');
    console.log('  ' + bold('1.') + ' Give your AI coding agent web tools:');
    console.log('     ' + cyan('npx @arcede/air-sdk install-skill'));
    console.log('');
    console.log('  ' + bold('2.') + ' Or wrap your Playwright/Puppeteer code:');
    console.log("     import { withAIR } from '@arcede/air-sdk/playwright';");
    console.log('     const smartPage = withAIR(page, { apiKey: process.env.AIR_API_KEY });');
    console.log('');
    console.log('  Docs: ' + cyan('https://agentinternetruntime.com/docs/sdk'));
    console.log('');
  } finally {
    rl.close();
  }
}

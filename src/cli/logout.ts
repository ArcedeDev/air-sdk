import * as fs from 'node:fs';
import * as readline from 'node:readline';
import { bold, dim, green, yellow, cyan } from './colors';
import { removeCredentials, getCredentialsPath } from './config';
import { getTargets, MCP_SERVER_KEY, readJsonFile, writeJsonFile } from './install-skill';

/**
 * AIR SDK — logout
 * Removes API key from global config and optionally from MCP agent configs.
 */
export async function runLogout(): Promise<void> {
  console.log('');
  console.log('  ' + bold('AIR SDK — Logout'));
  console.log('  ' + dim('─'.repeat(22)));
  console.log('');

  let removedAnything = false;

  // 1. Remove global credentials
  const credPath = getCredentialsPath();
  if (fs.existsSync(credPath)) {
    removeCredentials();
    console.log('  ' + green('✓') + ' Removed ' + dim(credPath));
    removedAnything = true;
  } else {
    console.log('  ' + dim('· No global credentials found'));
  }

  // 2. Remove from MCP agent configs
  const targets = getTargets();
  for (const target of targets) {
    if (!fs.existsSync(target.configPath)) continue;

    const raw = readJsonFile(target.configPath);
    if (!raw) continue;

    const config = raw as { mcpServers?: Record<string, unknown>; [key: string]: unknown };
    if (config.mcpServers && config.mcpServers[MCP_SERVER_KEY]) {
      delete config.mcpServers[MCP_SERVER_KEY];

      // Clean up empty mcpServers object
      if (Object.keys(config.mcpServers).length === 0) {
        delete config.mcpServers;
      }

      writeJsonFile(target.configPath, config);
      console.log('  ' + green('✓') + ' Removed from ' + bold(target.name) + dim(' — ' + target.configPath));
      removedAnything = true;
    }
  }

  // 3. Check for .env in current directory
  const envPath = require('node:path').resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, 'utf-8');
      if (content.includes('AIR_API_KEY=')) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const ask = (q: string): Promise<string> => new Promise(r => rl.question(q, r));

        try {
          const remove = await ask('  Remove AIR_API_KEY from .env? (y/N): ');
          if (remove.toLowerCase() === 'y') {
            const updated = content.replace(/^AIR_API_KEY=.+\n?/m, '');
            fs.writeFileSync(envPath, updated);
            console.log('  ' + green('✓') + ' Removed from ' + dim('.env'));
            removedAnything = true;
          } else {
            console.log('  ' + dim('· Kept .env unchanged'));
          }
        } finally {
          rl.close();
        }
      }
    } catch {
      // Ignore .env read errors
    }
  }

  console.log('');
  if (removedAnything) {
    console.log('  ' + green('Logged out.') + ' Restart your agent for changes to take effect.');
  } else {
    console.log('  ' + dim('Nothing to remove — no credentials found.'));
  }
  console.log('');
  console.log('  To set up again: ' + cyan('npx @arcede/air-sdk init'));
  console.log('');
}

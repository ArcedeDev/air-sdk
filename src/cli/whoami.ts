import * as fs from 'node:fs';
import { bold, dim, green, yellow, cyan, red } from './colors';
import { resolveApiKey, maskKey, sourceLabel, getCredentialsPath } from './config';
import { getTargets, MCP_SERVER_KEY } from './install-skill';

const API_BASE = 'https://api.agentinternetruntime.com';

/**
 * AIR SDK — whoami
 * Shows current API key, where it's stored, and which agents have it configured.
 */
export async function runWhoami(): Promise<void> {
  console.log('');
  console.log('  ' + bold('AIR SDK — Who Am I'));
  console.log('  ' + dim('─'.repeat(24)));
  console.log('');

  // 1. Resolve key
  const resolved = resolveApiKey();

  if (!resolved) {
    console.log('  ' + yellow('⚠') + ' No API key configured.');
    console.log('');
    console.log('  Run ' + cyan('npx @arcede/air-sdk init') + ' to set up.');
    console.log('');
    return;
  }

  console.log('  ' + bold('API Key:') + '  ' + dim(maskKey(resolved.key)));
  console.log('  ' + bold('Source:') + '   ' + sourceLabel(resolved.source));
  if (resolved.path) {
    console.log('  ' + bold('Path:') + '     ' + dim(resolved.path));
  }

  // 2. Check global config
  const credPath = getCredentialsPath();
  if (fs.existsSync(credPath)) {
    console.log('  ' + bold('Global:') + '   ' + green('✓') + dim(' ' + credPath));
  } else {
    console.log('  ' + bold('Global:') + '   ' + dim('not configured'));
  }

  // 3. Check which agents have air-sdk configured
  console.log('');
  console.log('  ' + bold('Agent Configurations:'));
  const targets = getTargets();
  for (const target of targets) {
    if (!fs.existsSync(target.configPath)) {
      console.log('    ' + dim('· ' + target.name + ' — not installed'));
      continue;
    }

    try {
      const raw = fs.readFileSync(target.configPath, 'utf-8');
      const config = JSON.parse(raw);
      if (config?.mcpServers?.[MCP_SERVER_KEY]) {
        const entry = config.mcpServers[MCP_SERVER_KEY];
        const configKey = entry?.env?.AIR_API_KEY;
        if (configKey) {
          const matches = configKey === resolved.key;
          const status = matches ? green('✓') : yellow('⚠ different key');
          console.log('    ' + status + ' ' + bold(target.name) + dim(' — ' + maskKey(configKey)));
        } else {
          console.log('    ' + yellow('⚠') + ' ' + bold(target.name) + dim(' — no key in env block'));
        }
      } else {
        console.log('    ' + dim('· ' + target.name + ' — air-sdk not registered'));
      }
    } catch {
      console.log('    ' + dim('· ' + target.name + ' — could not read config'));
    }
  }

  // 4. Verify key with API
  console.log('');
  try {
    const verifyRes = await fetch(API_BASE + '/api/v1/sdk/capabilities?domain=example.com', {
      headers: { 'Authorization': 'Bearer ' + resolved.key },
      signal: AbortSignal.timeout(5000),
    });
    if (verifyRes.ok) {
      console.log('  ' + bold('API Status:') + ' ' + green('✓') + ' Key is valid');
    } else if (verifyRes.status === 401) {
      console.log('  ' + bold('API Status:') + ' ' + red('✗') + ' Key rejected (401)');
    } else {
      console.log('  ' + bold('API Status:') + ' ' + yellow('⚠') + ' API returned ' + verifyRes.status);
    }
  } catch {
    console.log('  ' + bold('API Status:') + ' ' + yellow('⚠') + ' Could not reach API');
  }

  console.log('');
}

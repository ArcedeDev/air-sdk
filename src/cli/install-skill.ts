import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as readline from 'node:readline';
import { execSync, spawn } from 'node:child_process';
import { bold, dim, green, red, yellow, cyan } from './colors';
import {
  resolveApiKey,
  saveCredentials,
  maskKey,
  isValidKeyFormat,
  sourceLabel,
} from './config';

// ============================================================
// AIR SDK — install-skill
// Registers the AIR MCP server into Claude Desktop, Claude Code,
// Cursor, Windsurf, and OpenClaw.
//
// Usage:
//   npx @arcede/air-sdk install-skill
//   npx @arcede/air-sdk install-skill --dry-run
// ============================================================

interface McpServerEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}

interface McpConfig {
  mcpServers?: Record<string, McpServerEntry>;
  [key: string]: unknown;
}

const MCP_SERVER_KEY = 'air-sdk';
const DASHBOARD_URL = 'https://agentinternetruntime.com/extract/dashboard/sdk';

/** Check if air-sdk is globally installed and return the binary path. */
function findGlobalBinary(): string | null {
  try {
    const cmd = process.platform === 'win32' ? 'where air-sdk' : 'which air-sdk';
    const result = execSync(cmd, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return result || null;
  } catch {
    return null;
  }
}

/** Install @arcede/air-sdk globally. Returns true on success. */
function installGlobally(): boolean {
  try {
    console.log('  ' + dim('Installing @arcede/air-sdk globally for fast startup (~2s vs ~60s)...'));
    execSync('npm install -g @arcede/air-sdk', {
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
      timeout: 60_000,
    });
    return true;
  } catch (err: any) {
    // Common failure: EACCES on macOS/Linux (needs sudo or nvm)
    const msg = err?.stderr?.toString() || err?.message || '';
    if (msg.includes('EACCES') || msg.includes('permission')) {
      console.log('  ' + dim('Permission denied — try: npm config set prefix ~/.npm-global'));
    }
    return false;
  }
}

/** The MCP server config block we inject. Uses absolute global binary path if available to avoid npx caching issues. */
function buildMcpEntry(apiKey: string, globalBinaryPath: string | null): McpServerEntry {
  if (globalBinaryPath) {
    return {
      command: globalBinaryPath,
      args: ['--mcp'],
      env: { AIR_API_KEY: apiKey },
    };
  }
  return {
    command: 'npx',
    args: ['-y', '@arcede/air-sdk', '--mcp'],
    env: { AIR_API_KEY: apiKey },
  };
}

/** Safely read a JSON file, returning null on failure. */
function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Write a JSON object back to disk with pretty-printing. */
function writeJsonFile(filePath: string, data: Record<string, unknown>): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

/** Check if the air-sdk MCP entry already exists in a config. */
function hasExistingEntry(config: McpConfig): boolean {
  return !!(config.mcpServers && config.mcpServers[MCP_SERVER_KEY]);
}

/** Inject the air-sdk MCP server entry into a config object. */
function injectMcpServer(config: McpConfig, apiKey: string, globalBinaryPath: string | null): McpConfig {
  const updated = { ...config };
  if (!updated.mcpServers) {
    updated.mcpServers = {};
  }
  updated.mcpServers[MCP_SERVER_KEY] = buildMcpEntry(apiKey, globalBinaryPath);
  return updated;
}

// ---- Target Definitions ----

interface InstallTarget {
  name: string;
  configPath: string;
}

/** Resolve the platform-specific Claude Desktop config directory. */
function claudeDesktopConfigDir(home: string): string {
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Claude');
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Claude');
  }
  // Linux / other
  return path.join(home, '.config', 'Claude');
}

function getTargets(): InstallTarget[] {
  const home = os.homedir();
  return [
    {
      name: 'Claude Desktop',
      configPath: path.join(claudeDesktopConfigDir(home), 'claude_desktop_config.json'),
    },
    {
      name: 'Claude Code',
      configPath: path.join(home, '.claude.json'),
    },
    {
      name: 'Cursor',
      configPath: path.join(home, '.cursor', 'mcp.json'),
    },
    {
      name: 'Windsurf',
      configPath: path.join(home, '.codeium', 'windsurf', 'mcp_config.json'),
    },
    {
      name: 'OpenClaw',
      configPath: path.join(home, '.openclaw', 'openclaw.json'),
    },
  ];
}

/** Export targets for use by logout command. */
export { getTargets, MCP_SERVER_KEY, readJsonFile, writeJsonFile };

// ---- Main ----

export async function runInstallSkill(flags?: string[]): Promise<void> {
  const dryRun = flags?.includes('--dry-run') ?? false;

  if (flags?.includes('--help') || flags?.includes('-h')) {
    console.log(`
  ${bold('air-sdk install-skill')} — Register AIR as an agent skill

  ${bold('Usage:')}
    npx @arcede/air-sdk install-skill ${dim('[options]')}

  ${bold('Options:')}
    --dry-run    Preview changes without modifying files
    --help, -h   Show this help message

  ${bold('What it does:')}
    Auto-detects Claude Desktop, Claude Code, Cursor, Windsurf, and
    OpenClaw, then writes the MCP server config and injects your API
    key. Uses the absolute binary path (not npx) for reliable version
    management. Your agent gets 5 tools: extract_url,
    browse_capabilities, execute_capability, report_outcome, and extract_content.

  ${bold('Docs:')} ${cyan('https://agentinternetruntime.com/docs/sdk')}
`);
    return;
  }

  console.log('');
  console.log('  ' + bold('AIR SDK — Install Agent Skill'));
  console.log('  ' + dim('─'.repeat(34)));
  if (dryRun) {
    console.log('  ' + dim('(dry run — no files will be modified)'));
  }
  console.log('');

  // 1. Resolve API key from all sources
  let resolved = resolveApiKey();
  let apiKey: string;

  if (resolved) {
    console.log('  Using key: ' + dim(maskKey(resolved.key)));
    console.log('  Source: ' + dim(sourceLabel(resolved.source)));
    console.log('');
    apiKey = resolved.key;
  } else {
    // No key found — prompt interactively
    console.log('  ' + yellow('⚠') + ' No API key found.');
    console.log(dim('    Checked: AIR_API_KEY env var, ~/.config/air/credentials.json, .env'));
    console.log('');

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q: string): Promise<string> => new Promise(r => rl.question(q, r));

    try {
      const key = (await ask('  Paste your API key (or press Enter to open dashboard): ')).trim();

      if (!key) {
        // Open dashboard and ask again
        console.log('');
        console.log('  Opening dashboard...');
        try {
          const openCmd = process.platform === 'darwin' ? 'open' :
            process.platform === 'win32' ? 'cmd' : 'xdg-open';
          const openArgs = process.platform === 'win32'
            ? ['/c', 'start', DASHBOARD_URL]
            : [DASHBOARD_URL];
          const child = spawn(openCmd, openArgs, { detached: true, stdio: 'ignore' });
          child.unref();
        } catch { /* best-effort */ }

        console.log('  Get your key at: ' + cyan(DASHBOARD_URL));
        console.log('');
        const retryKey = (await ask('  API Key: ')).trim();

        if (!retryKey) {
          console.error('\n  ' + red('No key provided. Aborting.'));
          rl.close();
          process.exit(1);
        }
        apiKey = retryKey;
      } else {
        apiKey = key;
      }
    } finally {
      rl.close();
    }

    if (!isValidKeyFormat(apiKey)) {
      console.error('\n  ' + red('Invalid key format.') + ' AIR SDK keys start with "air_".');
      console.error('  Get one at: ' + cyan(DASHBOARD_URL));
      process.exit(1);
    }

    // Save to global config so user doesn't have to enter again
    try {
      saveCredentials(apiKey, 'install-skill');
      console.log('');
      console.log('  ' + green('✓') + ' Key saved to ' + dim('~/.config/air/credentials.json'));
    } catch {
      // Non-fatal — we can still install the skill
    }

    console.log('');
  }

  // 2. Install globally for fast MCP startup (~2s vs ~60s)
  //    We use the absolute binary path in configs to avoid npx caching issues on upgrades.
  let globalBinaryPath = findGlobalBinary();
  if (!globalBinaryPath && !dryRun) {
    const didInstall = installGlobally();
    if (didInstall) {
      globalBinaryPath = findGlobalBinary();
    }
    if (globalBinaryPath) {
      console.log('  ' + green('✓') + ' Installed globally ' + dim('(agent startup ~2s instead of ~60s)'));
    } else {
      console.log('  ' + yellow('⚠') + ' Global install failed — falling back to npx ' + dim('(~60s startup)'));
      console.log('    ' + dim('To fix: run "npm install -g @arcede/air-sdk" manually'));
    }
  } else if (globalBinaryPath) {
    console.log('  ' + green('✓') + ' Global binary found ' + dim('(' + globalBinaryPath + ')'));
  } else if (dryRun) {
    console.log('  → Would install @arcede/air-sdk globally ' + dim('(npm install -g)'));
  }
  console.log('');

  // 3. Detect which targets exist
  const targets = getTargets();
  const detected = targets.filter(t => fs.existsSync(t.configPath));
  const skipped = targets.filter(t => !fs.existsSync(t.configPath));

  if (detected.length === 0) {
    console.log('  ' + yellow('⚠') + ' No supported agent configs detected.');
    console.log('');
    console.log(dim('  Looked for:'));
    for (const t of targets) {
      console.log(dim('    • ' + t.name + ' — ' + t.configPath));
    }
    console.log('');
    console.log('  You can configure manually:');
    if (globalBinaryPath) {
      console.log('    ' + cyan('claude mcp add air-sdk -- ' + globalBinaryPath + ' --mcp'));
    } else {
      console.log('    ' + cyan('claude mcp add air-sdk -- npx -y @arcede/air-sdk --mcp'));
    }
    console.log('');
    return;
  }

  // 4. Install to detected targets
  let installed = 0;
  let updated = 0;

  for (const target of detected) {
    const existing = readJsonFile(target.configPath);
    const config: McpConfig = (existing as McpConfig) ?? {};
    const wasExisting = hasExistingEntry(config);
    const updatedConfig = injectMcpServer(config, apiKey, globalBinaryPath);

    if (dryRun) {
      const verb = wasExisting ? 'update' : 'install to';
      console.log('  → Would ' + verb + ' ' + bold(target.name) + dim(' — ' + target.configPath));
    } else {
      writeJsonFile(target.configPath, updatedConfig as Record<string, unknown>);
      if (wasExisting) {
        console.log('  ' + green('✓') + ' ' + bold(target.name) + dim(' — updated existing config'));
        updated++;
      } else {
        console.log('  ' + green('✓') + ' ' + bold(target.name) + dim(' — installed'));
        installed++;
      }
    }
  }

  // 5. Report skipped targets
  if (skipped.length > 0) {
    console.log('');
    for (const t of skipped) {
      console.log('  ' + dim('· ' + t.name + ' — not detected (skipped)'));
    }
  }

  console.log('');

  if (dryRun) {
    console.log('  Re-run without --dry-run to apply changes.');
    console.log('');
    return;
  }

  // 6. Summary
  const total = installed + updated;
  if (installed > 0 && updated > 0) {
    console.log('  ' + green('Done!') + ' Installed to ' + installed + ', updated ' + updated + ' agent(s).');
  } else if (updated > 0) {
    console.log('  ' + green('Done!') + ' Updated ' + total + ' agent(s).');
  } else {
    console.log('  ' + green('Done!') + ' Installed to ' + total + ' agent(s).');
  }
  console.log(dim('  Restart your agent to activate.'));
  console.log('');
  console.log('  ' + bold('Your agent now has 5 tools:'));
  console.log('    ' + cyan('extract_url') + '          — Extract structured data from any URL');
  console.log('    ' + cyan('browse_capabilities') + '  — Discover what actions are possible on a site');
  console.log('    ' + cyan('execute_capability') + '   — Get a step-by-step execution plan');
  console.log('    ' + cyan('report_outcome') + '       — Report results to improve collective intelligence');
  console.log('    ' + cyan('extract_content') + '      — Extract text and sections from local or remote files');
  console.log('');
  console.log('  ' + bold('Try it:'));
  console.log('    ' + dim('"Use AIR to browse capabilities on amazon.com"'));
  console.log('');
}

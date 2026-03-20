#!/usr/bin/env node

/**
 * AIR SDK CLI entry point.
 *
 *   npx @arcede/air-sdk init            → Interactive setup (save key to ~/.config/air/)
 *   npx @arcede/air-sdk install-skill   → Register AIR as an agent skill (Claude Code, Cursor, Windsurf)
 *   npx @arcede/air-sdk whoami          → Show current key, source, and agent status
 *   npx @arcede/air-sdk logout          → Remove key from all locations
 *   npx @arcede/air-sdk --mcp           → Start MCP server
 *   npx @arcede/air-sdk --version       → Print version
 *   npx @arcede/air-sdk --help          → Show help
 */

import { SDK_VERSION } from '../version';
import { bold, dim, cyan } from './colors';

const args = process.argv.slice(2);
const command = args[0];

if (command === 'init') {
  if (args.includes('--help') || args.includes('-h')) {
    showInitHelp();
  } else {
    import('./init').then(m => m.runInit()).catch(fatal);
  }
} else if (command === 'install-skill') {
  const flags = args.slice(1);
  import('./install-skill').then(m => m.runInstallSkill(flags)).catch(fatal);
} else if (command === 'whoami') {
  if (args.includes('--help') || args.includes('-h')) {
    showWhoamiHelp();
  } else {
    import('./whoami').then(m => m.runWhoami()).catch(fatal);
  }
} else if (command === 'logout') {
  if (args.includes('--help') || args.includes('-h')) {
    showLogoutHelp();
  } else {
    import('./logout').then(m => m.runLogout()).catch(fatal);
  }
} else if (args.includes('--mcp')) {
  import('../mcp/server').then(m => m.default()).catch(fatal);
} else if (args.includes('--version') || args.includes('-v')) {
  console.log('@arcede/air-sdk v' + SDK_VERSION);
} else {
  showHelp();
}

function showHelp(): void {
  console.log(`
  ${bold('AIR SDK')} ${dim('v' + SDK_VERSION)} — Collective intelligence for browser automation agents

  ${bold('Commands:')}
    ${cyan('init')}                       Set up your API key (saved to ~/.config/air/)
    ${cyan('install-skill')}              Register AIR as an agent skill (Claude Code, Cursor, Windsurf)
    ${cyan('whoami')}                     Show current API key, source, and agent status
    ${cyan('logout')}                     Remove API key from all locations

  ${bold('Server:')}
    ${cyan('--mcp')}                      Start the MCP server (used by agent configs)

  ${bold('Options:')}
    --version, -v              Print version
    --help, -h                 Show help (works on subcommands too)

  ${bold('Quick start:')}
    npx @arcede/air-sdk init
    npx @arcede/air-sdk install-skill

  ${bold('Credential storage:')}
    API keys are stored at ${dim('~/.config/air/credentials.json')} (0600 permissions).
    MCP agent configs receive the key via the env block (required by protocol).
    Run ${cyan('logout')} to remove your key from all locations.

  ${bold('Docs:')} ${cyan('https://agentinternetruntime.com/docs/sdk')}
`);
}

function showInitHelp(): void {
  console.log(`
  ${bold('air-sdk init')} — Interactive API key setup

  ${bold('Usage:')}
    npx @arcede/air-sdk init

  ${bold('What it does:')}
    Opens your dashboard to generate an API key. Saves it to
    ${dim('~/.config/air/credentials.json')} (0600 permissions). Optionally saves
    to .env for Playwright/Puppeteer usage. Verifies the key works.

  ${bold('After init, run:')}
    ${cyan('npx @arcede/air-sdk install-skill')}

  ${bold('Docs:')} ${cyan('https://agentinternetruntime.com/docs/sdk')}
`);
}

function showWhoamiHelp(): void {
  console.log(`
  ${bold('air-sdk whoami')} — Show current API key and status

  ${bold('Usage:')}
    npx @arcede/air-sdk whoami

  ${bold('What it shows:')}
    Current API key (masked), where it was resolved from, which agent
    configs have air-sdk registered, and whether the key is valid.

  ${bold('Key resolution order:')}
    1. AIR_API_KEY environment variable
    2. ~/.config/air/credentials.json
    3. .env in current directory
`);
}

function showLogoutHelp(): void {
  console.log(`
  ${bold('air-sdk logout')} — Remove API key from all locations

  ${bold('Usage:')}
    npx @arcede/air-sdk logout

  ${bold('What it removes:')}
    - ~/.config/air/credentials.json (global config)
    - air-sdk entry from Claude Code, Cursor, and Windsurf configs
    - Optionally: AIR_API_KEY from .env in current directory
`);
}

function fatal(err: unknown): void {
  console.error('Fatal:', err instanceof Error ? err.message : String(err));
  process.exit(1);
}

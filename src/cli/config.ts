/**
 * AIR SDK — Global credential store.
 *
 * Stores credentials at ~/.config/air/credentials.json (XDG-compliant).
 * File permissions are set to 0600 (owner read/write only).
 *
 * Resolution order for API key:
 *   1. AIR_API_KEY environment variable (explicit override)
 *   2. ~/.config/air/credentials.json (global config — primary store)
 *   3. ./.env in current directory (project-local, backward compat)
 *   4. Interactive prompt (if available)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ─── Paths ───────────────────────────────────────────────────────────

function getConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg || path.join(os.homedir(), '.config');
  return path.join(base, 'air');
}

function getCredentialsPath(): string {
  return path.join(getConfigDir(), 'credentials.json');
}

export { getConfigDir, getCredentialsPath };

// ─── Credential Types ────────────────────────────────────────────────

interface Credentials {
  api_key: string;
  created_at: string;
  source?: string; // 'init' | 'install-skill' | 'manual'
}

// ─── Read / Write ────────────────────────────────────────────────────

/** Read credentials from the global config. Returns null if not found. */
export function readCredentials(): Credentials | null {
  const credPath = getCredentialsPath();
  try {
    if (!fs.existsSync(credPath)) return null;

    // SSH-style permission check: warn if credentials are group/world-readable
    try {
      const stat = fs.statSync(credPath);
      const mode = stat.mode & 0o777;
      if (mode & 0o077) {
        const octal = '0' + mode.toString(8);
        process.stderr.write(
          `@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\n` +
          `@         WARNING: UNPROTECTED CREDENTIALS FILE!         @\n` +
          `@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\n` +
          `Permissions ${octal} for '${credPath}' are too open.\n` +
          `It is required that your credentials file is NOT accessible by others.\n` +
          `Run: chmod 600 ${credPath}\n\n`,
        );
      }
    } catch {
      // stat failed — proceed anyway
    }

    const raw = fs.readFileSync(credPath, 'utf-8');
    const data = JSON.parse(raw);
    if (data?.api_key && typeof data.api_key === 'string') {
      return data as Credentials;
    }
    return null;
  } catch {
    return null;
  }
}

/** Save credentials to the global config with 0600 permissions. */
export function saveCredentials(apiKey: string, source: string): void {
  const configDir = getConfigDir();
  const credPath = getCredentialsPath();

  // Ensure directory exists with 0700 (explicit chmod to override umask)
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  fs.chmodSync(configDir, 0o700);

  const data: Credentials = {
    api_key: apiKey,
    created_at: new Date().toISOString(),
    source,
  };

  fs.writeFileSync(credPath, JSON.stringify(data, null, 2) + '\n', {
    encoding: 'utf-8',
  });
  // Explicit chmod — writeFileSync mode only applies on creation, not overwrite
  fs.chmodSync(credPath, 0o600);
}

/** Remove credentials file. Returns true if removed. */
export function removeCredentials(): boolean {
  const credPath = getCredentialsPath();
  try {
    if (fs.existsSync(credPath)) {
      fs.unlinkSync(credPath);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ─── Key Resolution ──────────────────────────────────────────────────

export interface ResolvedKey {
  key: string;
  source: 'env' | 'global_config' | 'dotenv';
  path?: string;
}

/**
 * Resolve API key from all sources in priority order.
 * Returns the key and where it came from, or null if not found.
 */
export function resolveApiKey(): ResolvedKey | null {
  // 1. Environment variable (highest priority — explicit override)
  if (process.env.AIR_API_KEY) {
    return { key: process.env.AIR_API_KEY, source: 'env' };
  }

  // 2. Global config (~/.config/air/credentials.json)
  const creds = readCredentials();
  if (creds) {
    return { key: creds.api_key, source: 'global_config', path: getCredentialsPath() };
  }

  // 3. Local .env (backward compatibility)
  const envKey = readDotEnvKey();
  if (envKey) {
    return { key: envKey.key, source: 'dotenv', path: envKey.path };
  }

  return null;
}

/** Read AIR_API_KEY from .env in current directory. */
function readDotEnvKey(): { key: string; path: string } | null {
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return null;
    const content = fs.readFileSync(envPath, 'utf-8');
    const match = content.match(/^AIR_API_KEY=(.+)$/m);
    if (match) {
      const key = match[1].trim().replace(/^["']|["']$/g, '');
      return { key, path: envPath };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── .env helpers ────────────────────────────────────────────────────

/** Write AIR_API_KEY to a .env file (for programmatic Playwright/Puppeteer usage). */
export function writeDotEnvKey(envPath: string, key: string): void {
  const line = 'AIR_API_KEY=' + key;
  try {
    if (fs.existsSync(envPath)) {
      let content = fs.readFileSync(envPath, 'utf-8');
      if (content.includes('AIR_API_KEY=')) {
        content = content.replace(/^AIR_API_KEY=.+$/m, line);
      } else {
        content = content.trimEnd() + '\n' + line + '\n';
      }
      fs.writeFileSync(envPath, content);
    } else {
      fs.writeFileSync(envPath, line + '\n');
    }
  } catch (err) {
    throw new Error('Could not write .env: ' + (err instanceof Error ? err.message : String(err)));
  }
}

// ─── Utilities ───────────────────────────────────────────────────────

/** Mask an API key for display: show first 12 and last 4 chars. */
export function maskKey(key: string): string {
  if (key.length <= 8) return key.slice(0, 4) + '...';
  return key.slice(0, 12) + '...' + key.slice(-4);
}

/** Validate key format. */
export function isValidKeyFormat(key: string): boolean {
  return key.startsWith('air_') && key.length > 10;
}

/** Source label for display. */
export function sourceLabel(source: ResolvedKey['source']): string {
  switch (source) {
    case 'env': return 'AIR_API_KEY environment variable';
    case 'global_config': return '~/.config/air/credentials.json';
    case 'dotenv': return '.env file';
  }
}

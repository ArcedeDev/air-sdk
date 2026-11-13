// File and URL guards for extract_content.
//
// extract_content uploads what it reads to the AIR API, so an agent that has been
// steered by untrusted content must not be able to point it at credentials on disk
// or at services that are only reachable from the user's machine. These checks bound
// what the tool will read; they do not replace the client's own tool-approval prompts.

import { promises as fsp } from 'fs';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import path from 'path';

/** Document types the extract-content API accepts (see the tool description). */
export const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.docx', '.pptx', '.xlsx', '.csv', '.txt', '.md', '.html', '.htm', '.eml',
]);

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export class FileGuardError extends Error {}

/**
 * Resolve a local path for upload. The real path (after symlinks) must be a regular
 * file with a supported document extension, no larger than MAX_FILE_BYTES, and must
 * not sit in a hidden file or directory (~/.ssh, ~/.aws, .env, .git, ...).
 */
export async function resolveLocalDocument(filePath: string): Promise<string> {
  let real: string;
  try {
    real = await fsp.realpath(filePath);
  } catch {
    throw new FileGuardError('File not found or not readable.');
  }
  const segments = real.split(path.sep).filter(Boolean);
  if (segments.some((segment) => segment.startsWith('.'))) {
    throw new FileGuardError('Files in hidden files or directories are not uploaded.');
  }
  const extension = path.extname(real).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new FileGuardError(
      `Unsupported file type "${extension || 'none'}". Supported: ${[...ALLOWED_EXTENSIONS].join(', ')}.`
    );
  }
  const stat = await fsp.stat(real);
  if (!stat.isFile()) throw new FileGuardError('Path is not a regular file.');
  if (stat.size > MAX_FILE_BYTES) throw new FileGuardError('File is larger than the 50 MB limit.');
  return real;
}

function ipv4Octets(address: string): number[] | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null;
}

function isBlockedIPv4(octets: number[]): boolean {
  const [a, b, c] = octets;
  return (
    a === 0 || // "this network"
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, including cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast and reserved
  );
}

/** Expand an IPv6 address to eight 16-bit groups, or null if it is malformed. */
function ipv6Groups(address: string): number[] | null {
  let text = address.toLowerCase().split('%')[0];
  // Rewrite a trailing dotted IPv4 part (::ffff:127.0.0.1) as two hex groups.
  const lastColon = text.lastIndexOf(':');
  const last = text.slice(lastColon + 1);
  if (last.includes('.')) {
    const octets = ipv4Octets(last);
    if (!octets) return null;
    text = `${text.slice(0, lastColon + 1)}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parse = (half: string): number[] | null => {
    if (half === '') return [];
    const groups = half.split(':');
    return groups.every((g) => /^[0-9a-f]{1,4}$/.test(g)) ? groups.map((g) => parseInt(g, 16)) : null;
  };
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  if (!head || !rest) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - rest.length;
  return fill >= 1 ? [...head, ...new Array(fill).fill(0), ...rest] : null;
}

/** Loopback, private, link-local, multicast and other non-public addresses. */
export function isBlockedAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const octets = ipv4Octets(address);
    return !octets || isBlockedIPv4(octets);
  }
  const groups = ipv6Groups(address);
  if (!groups) return true;
  const embeddedV4 = [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff];
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) return isBlockedIPv4(embeddedV4); // ::ffff:a.b.c.d
  if (groups[0] === 0x64 && groups[1] === 0xff9b) return isBlockedIPv4(embeddedV4); // NAT64
  if (groups.slice(0, 7).every((g) => g === 0)) return true; // :: and ::1
  const first = groups[0];
  return (
    (first & 0xfe00) === 0xfc00 || // unique local
    (first & 0xffc0) === 0xfe80 || // link-local
    (first & 0xff00) === 0xff00 // multicast
  );
}

async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FileGuardError('file_url is not a valid URL.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new FileGuardError('file_url must use http or https.');
  }
  if (url.username || url.password) throw new FileGuardError('file_url must not contain credentials.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host)
    ? [host]
    : await lookup(host, { all: true, verbatim: true }).then(
        (results) => results.map((result) => result.address),
        () => {
          throw new FileGuardError(`Could not resolve host ${host}.`);
        }
      );
  if (addresses.length === 0 || addresses.some(isBlockedAddress)) {
    throw new FileGuardError('file_url must point to a public internet address.');
  }
  return url;
}

/**
 * Fetch a document from a public URL. Every redirect hop is re-checked, and the body is
 * capped at MAX_FILE_BYTES. A host whose DNS answer changes between the check and the
 * request is a residual risk this check does not close.
 */
export async function fetchPublicDocument(raw: string, timeoutMs = 30000): Promise<{ blob: Blob; url: URL }> {
  const signal = AbortSignal.timeout(timeoutMs);
  let url = await assertPublicUrl(raw);
  for (let hop = 0; ; hop++) {
    const resp = await fetch(url, { redirect: 'manual', signal });
    if (resp.status >= 300 && resp.status < 400 && resp.headers.get('location')) {
      if (hop >= MAX_REDIRECTS) throw new FileGuardError('Too many redirects.');
      url = await assertPublicUrl(new URL(resp.headers.get('location')!, url).toString());
      continue;
    }
    if (!resp.ok) throw new FileGuardError(`Failed to fetch file from URL: ${resp.status} ${resp.statusText}`);
    const declared = Number(resp.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_FILE_BYTES) {
      throw new FileGuardError('File is larger than the 50 MB limit.');
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (resp.body) {
      const reader = resp.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_FILE_BYTES) {
          await reader.cancel();
          throw new FileGuardError('File is larger than the 50 MB limit.');
        }
        chunks.push(value);
      }
    }
    const type = resp.headers.get('content-type') ?? undefined;
    return { blob: new Blob([Buffer.concat(chunks)], type ? { type } : undefined), url };
  }
}

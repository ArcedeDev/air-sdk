import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { promises as fsp } from 'fs';
import os from 'os';
import path from 'path';
import {
  isBlockedAddress,
  resolveLocalDocument,
  fetchPublicDocument,
  MAX_FILE_BYTES,
} from '../../src/mcp/file-guard';

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fe80::1', 'fd00::1', 'fc00::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:169.254.169.254', '::ffff:7f00:1', '64:ff9b::a9fe:a9fe', 'not-an-ip',
  ])('blocks %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(['1.1.1.1', '8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    'allows %s',
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    }
  );
});

describe('resolveLocalDocument', () => {
  let dir: string;

  beforeAll(async () => {
    // Under a non-hidden directory so the hidden-segment rule only sees our fixtures.
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'air-file-guard-'));
    await fsp.writeFile(path.join(dir, 'report.pdf'), 'pdf');
    await fsp.writeFile(path.join(dir, 'id_rsa'), 'secret');
    await fsp.writeFile(path.join(dir, 'notes.json'), '{}');
    await fsp.mkdir(path.join(dir, '.ssh'));
    await fsp.writeFile(path.join(dir, '.ssh', 'keys.txt'), 'secret');
    await fsp.writeFile(path.join(dir, '.env'), 'TOKEN=1');
    await fsp.symlink(path.join(dir, '.ssh', 'keys.txt'), path.join(dir, 'innocent.txt'));
    await fsp.mkdir(path.join(dir, 'folder.pdf'));
  });

  afterAll(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it('accepts a supported document', async () => {
    await expect(resolveLocalDocument(path.join(dir, 'report.pdf'))).resolves.toMatch(/report\.pdf$/);
  });

  it('rejects files without a supported document extension', async () => {
    await expect(resolveLocalDocument(path.join(dir, 'id_rsa'))).rejects.toThrow(/Unsupported file type/);
    await expect(resolveLocalDocument(path.join(dir, 'notes.json'))).rejects.toThrow(/Unsupported file type/);
  });

  it('rejects hidden files and directories', async () => {
    await expect(resolveLocalDocument(path.join(dir, '.ssh', 'keys.txt'))).rejects.toThrow(/hidden/);
    await expect(resolveLocalDocument(path.join(dir, '.env'))).rejects.toThrow(/hidden/);
  });

  it('follows symlinks before checking', async () => {
    await expect(resolveLocalDocument(path.join(dir, 'innocent.txt'))).rejects.toThrow(/hidden/);
  });

  it('rejects directories and missing files', async () => {
    await expect(resolveLocalDocument(path.join(dir, 'folder.pdf'))).rejects.toThrow(/regular file/);
    await expect(resolveLocalDocument(path.join(dir, 'missing.pdf'))).rejects.toThrow(/not found/);
  });
});

describe('fetchPublicDocument', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects non-http schemes, credentials and private addresses before fetching', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(fetchPublicDocument('file:///etc/passwd')).rejects.toThrow(/http or https/);
    await expect(fetchPublicDocument('https://user:pw@1.1.1.1/a.pdf')).rejects.toThrow(/credentials/);
    await expect(fetchPublicDocument('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(/public internet/);
    await expect(fetchPublicDocument('http://[::1]:8080/a.pdf')).rejects.toThrow(/public internet/);
    await expect(fetchPublicDocument('http://localhost:3000/a.pdf')).rejects.toThrow(/public internet/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('re-checks every redirect hop', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } })
    );
    vi.stubGlobal('fetch', fetchSpy);
    await expect(fetchPublicDocument('https://1.1.1.1/doc.pdf')).rejects.toThrow(/public internet/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
  });

  it('returns the body and final URL for a public document', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('hello', { status: 200 })));
    const { blob, url } = await fetchPublicDocument('https://1.1.1.1/files/doc.pdf');
    expect(await blob.text()).toBe('hello');
    expect(url.pathname).toBe('/files/doc.pdf');
  });

  it('enforces the size limit from content-length', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('x', { status: 200, headers: { 'content-length': String(MAX_FILE_BYTES + 1) } })
      )
    );
    await expect(fetchPublicDocument('https://1.1.1.1/big.pdf')).rejects.toThrow(/50 MB/);
  });
});

import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'adapters/playwright': 'src/adapters/playwright.ts',
    'adapters/puppeteer': 'src/adapters/puppeteer.ts',
    'adapters/browser-use': 'src/adapters/browser-use.ts',
    'mcp/server': 'src/mcp/server.ts',
    'cli/entry': 'src/cli/entry.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  splitting: true,
  treeshake: true,
  sourcemap: true,
  outDir: 'dist',
  target: 'node18',
  external: ['playwright', 'puppeteer'],
});

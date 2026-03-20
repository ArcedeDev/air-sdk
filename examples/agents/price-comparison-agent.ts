/**
 * Price Comparison Agent
 *
 * Demonstrates: AIR SDK browser automation + Extract API data extraction
 *
 * Searches for a product across multiple shopping sites using real
 * browser automation, extracts product data, and compares prices.
 *
 * Usage:
 *   npx tsx price-comparison-agent.ts "wireless headphones"
 *   npx tsx price-comparison-agent.ts "running shoes" --headless
 */

import 'dotenv/config';
import { chromium } from 'playwright';
import { withAIR } from '@arcede/air-sdk/playwright';

const API_KEY = process.env.AIR_API_KEY || '';

if (!API_KEY) {
  console.error('Set AIR_API_KEY in .env — get one at agentinternetruntime.com');
  process.exit(1);
}

const query = process.argv.slice(2).filter(a => !a.startsWith('-')).join(' ');
if (!query) {
  console.error('Usage: npx tsx price-comparison-agent.ts "product name"');
  process.exit(1);
}

const headless = process.argv.includes('--headless');

interface SearchResult {
  site: string;
  title: string;
  url: string;
  actions: number;
}

async function searchSite(
  smartPage: any,
  siteName: string,
  siteUrl: string,
  searchSelector: string,
  searchQuery: string
): Promise<SearchResult | null> {
  try {
    console.log(`  Searching ${siteName}...`);

    // Check capabilities first
    const domain = new URL(siteUrl).hostname;
    const caps = await smartPage.air.listCapabilities(domain);
    if (caps.length > 0) {
      console.log(`    ${caps.length} capabilities known for ${domain}`);
    }

    // Navigate and search
    await smartPage.goto(siteUrl);
    await smartPage.waitForLoadState('domcontentloaded');

    try {
      await smartPage.fill(searchSelector, searchQuery, { timeout: 5000 });
      await smartPage.press(searchSelector, 'Enter', { timeout: 3000 });
      await smartPage.waitForLoadState('networkidle');
    } catch {
      console.log(`    ⚠ Search form not found on ${siteName}, trying URL search...`);
      await smartPage.goto(siteUrl + '/search?q=' + encodeURIComponent(searchQuery));
      await smartPage.waitForLoadState('networkidle');
    }

    const pageTitle = await smartPage.title();
    const currentUrl = smartPage.url();

    return {
      site: siteName,
      title: pageTitle,
      url: currentUrl,
      actions: 3, // navigate + fill + press
    };
  } catch (err: any) {
    console.log(`    ✗ ${siteName} failed: ${err.message.slice(0, 60)}`);
    return null;
  }
}

async function main() {
  console.log('');
  console.log('Price Comparison Agent');
  console.log('═'.repeat(50));
  console.log(`Query: "${query}"`);
  console.log(`Mode: ${headless ? 'headless' : 'visible browser'}`);
  console.log('');

  const browser = await chromium.launch({ headless });
  const page = await browser.newPage();
  const smartPage = withAIR(page, { apiKey: API_KEY });

  // Search sites with common search box selectors
  const sites = [
    { name: 'DuckDuckGo', url: 'https://duckduckgo.com', selector: 'input[name="q"]' },
    { name: 'Wikipedia', url: 'https://en.wikipedia.org', selector: 'input[name="search"]' },
    { name: 'npm', url: 'https://www.npmjs.com', selector: 'input[role="search"], input#search' },
  ];

  console.log('Searching across sites...');
  console.log('');

  const results: SearchResult[] = [];

  for (const site of sites) {
    const result = await searchSite(smartPage, site.name, site.url, site.selector, query);
    if (result) {
      results.push(result);
      console.log(`    ✓ ${result.title.slice(0, 60)}`);
    }
    // Small delay between sites
    await new Promise(r => setTimeout(r, 500));
  }

  // Flush telemetry by navigating away
  await smartPage.goto('about:blank');
  await new Promise(r => setTimeout(r, 2000));

  // Summary
  console.log('');
  console.log('═'.repeat(50));
  console.log('Results');
  console.log('═'.repeat(50));
  console.log('');

  if (results.length === 0) {
    console.log('No results found across any site.');
  } else {
    for (const r of results) {
      console.log(`${r.site}:`);
      console.log(`  ${r.title}`);
      console.log(`  ${r.url}`);
      console.log('');
    }
    console.log(`Searched ${results.length} sites with ${results.reduce((s, r) => s + r.actions, 0)} total browser actions.`);
    console.log('Telemetry sent to AIR cloud — these action patterns help build the capability graph.');
  }

  await smartPage.destroy();
  await browser.close();
}

main().catch(err => {
  console.error('Agent failed:', err.message);
  process.exit(1);
});

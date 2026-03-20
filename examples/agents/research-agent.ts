/**
 * Research Agent
 *
 * Demonstrates: Extract API + AIR SDK working together
 *
 * Takes a URL, extracts its content, finds linked pages,
 * extracts those too, and produces a research summary.
 *
 * Usage:
 *   npx tsx research-agent.ts "https://en.wikipedia.org/wiki/Artificial_intelligence"
 *   npx tsx research-agent.ts "https://techcrunch.com" --depth 2
 */

import 'dotenv/config';
import { chromium } from 'playwright';
import { withAIR } from '@arcede/air-sdk/playwright';

const API_BASE = 'https://api.agentinternetruntime.com';
const API_KEY = process.env.AIR_API_KEY || '';
const EXTRACT_KEY = API_KEY;

if (!API_KEY) {
  console.error('Set AIR_API_KEY in .env — get one at agentinternetruntime.com');
  process.exit(1);
}

const targetUrl = process.argv[2];
if (!targetUrl) {
  console.error('Usage: npx tsx research-agent.ts <url>');
  process.exit(1);
}

const maxDepth = process.argv.includes('--depth')
  ? parseInt(process.argv[process.argv.indexOf('--depth') + 1]) || 1
  : 1;

interface ExtractedPage {
  url: string;
  title: string;
  description: string;
  contentItems: number;
  method: string;
}

async function extractUrl(url: string): Promise<ExtractedPage | null> {
  try {
    const res = await fetch(API_BASE + '/v1/extract', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + EXTRACT_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
    });

    if (!res.ok) {
      console.log(`  ✗ Extract failed for ${url}: HTTP ${res.status}`);
      return null;
    }

    const data = await res.json() as any;
    if (!data.success || !data.data) return null;

    return {
      url: data.data.url || url,
      title: data.data.title || 'Untitled',
      description: data.data.description || '',
      contentItems: data.data.content?.items?.length || 0,
      method: data.data.diagnostics?.extractionMethod || 'unknown',
    };
  } catch (err) {
    console.log(`  ✗ Network error for ${url}`);
    return null;
  }
}

async function main() {
  console.log('');
  console.log('Research Agent');
  console.log('═'.repeat(50));
  console.log(`Target: ${targetUrl}`);
  console.log(`Depth: ${maxDepth}`);
  console.log('');

  // Step 1: Launch browser with AIR SDK for capability awareness
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const smartPage = withAIR(page, { apiKey: API_KEY });

  // Step 2: Check what capabilities exist for this domain
  const domain = new URL(targetUrl).hostname;
  console.log(`Step 1: Checking capabilities for ${domain}...`);
  const caps = await smartPage.air.listCapabilities(domain);
  if (caps.length > 0) {
    console.log(`  Found ${caps.length} capabilities:`);
    caps.forEach(c => console.log(`    - ${c.name} (confidence: ${c.confidence})`));
  } else {
    console.log('  No pre-indexed capabilities (will extract fresh)');
  }

  // Step 3: Extract the target page
  console.log('');
  console.log('Step 2: Extracting target page...');
  const mainPage = await extractUrl(targetUrl);
  if (!mainPage) {
    console.error('  Failed to extract target URL');
    await browser.close();
    process.exit(1);
  }

  console.log(`  ✓ ${mainPage.title}`);
  console.log(`    ${mainPage.description.slice(0, 100)}${mainPage.description.length > 100 ? '...' : ''}`);
  console.log(`    ${mainPage.contentItems} content items via ${mainPage.method}`);

  // Step 4: Navigate with SDK to discover links
  console.log('');
  console.log('Step 3: Browsing page for related links...');
  await smartPage.goto(targetUrl);
  await smartPage.waitForLoadState('networkidle');

  const links = await smartPage.evaluate(() => {
    const anchors = document.querySelectorAll('a[href]');
    const urls: string[] = [];
    anchors.forEach(a => {
      const href = (a as HTMLAnchorElement).href;
      if (href.startsWith('http') && !href.includes('#') && urls.length < 5) {
        urls.push(href);
      }
    });
    return [...new Set(urls)].slice(0, 3); // Top 3 unique links
  });

  console.log(`  Found ${links.length} related links`);

  // Step 5: Extract related pages
  const relatedPages: ExtractedPage[] = [];
  if (maxDepth > 0 && links.length > 0) {
    console.log('');
    console.log('Step 4: Extracting related pages...');
    for (const link of links) {
      const extracted = await extractUrl(link);
      if (extracted) {
        relatedPages.push(extracted);
        console.log(`  ✓ ${extracted.title} (${extracted.contentItems} items)`);
      }
    }
  }

  // Step 6: Summary
  console.log('');
  console.log('═'.repeat(50));
  console.log('Research Summary');
  console.log('═'.repeat(50));
  console.log('');
  console.log(`Main: ${mainPage.title}`);
  console.log(`  ${mainPage.description}`);
  console.log('');

  if (relatedPages.length > 0) {
    console.log('Related:');
    relatedPages.forEach(p => {
      console.log(`  - ${p.title}`);
      console.log(`    ${p.url}`);
    });
  }

  console.log('');
  console.log(`Total: ${1 + relatedPages.length} pages extracted, ${mainPage.contentItems + relatedPages.reduce((s, p) => s + p.contentItems, 0)} content items`);

  await smartPage.destroy();
  await browser.close();
}

main().catch(err => {
  console.error('Agent failed:', err.message);
  process.exit(1);
});

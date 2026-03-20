/**
 * Site Monitor Agent
 *
 * Demonstrates: Extract API for periodic content monitoring
 *
 * Extracts a page repeatedly and detects changes in content.
 * Useful for monitoring news sites, product pages, or dashboards.
 *
 * Usage:
 *   npx tsx site-monitor-agent.ts "https://news.ycombinator.com"
 *   npx tsx site-monitor-agent.ts "https://example.com" --interval 30 --count 5
 */

import 'dotenv/config';

const API_BASE = 'https://api.agentinternetruntime.com';
const API_KEY = process.env.AIR_API_KEY || '';

if (!API_KEY) {
  console.error('Set AIR_API_KEY in .env — get one at agentinternetruntime.com');
  process.exit(1);
}

const targetUrl = process.argv[2];
if (!targetUrl || targetUrl.startsWith('-')) {
  console.error('Usage: npx tsx site-monitor-agent.ts <url> [--interval 60] [--count 3]');
  process.exit(1);
}

const interval = process.argv.includes('--interval')
  ? parseInt(process.argv[process.argv.indexOf('--interval') + 1]) || 60
  : 60;
const maxChecks = process.argv.includes('--count')
  ? parseInt(process.argv[process.argv.indexOf('--count') + 1]) || 3
  : 3;

interface Snapshot {
  timestamp: string;
  title: string;
  description: string;
  itemCount: number;
  method: string;
  cached: boolean;
  fingerprint: string;
}

async function extractSnapshot(url: string, force: boolean): Promise<Snapshot | null> {
  try {
    const res = await fetch(API_BASE + '/v1/extract', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url, options: { force } }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as any;
      console.log(`  ✗ Extraction failed: ${err.error || res.statusText}`);
      return null;
    }

    const data = await res.json() as any;
    if (!data.success || !data.data) return null;

    const d = data.data;
    // Create a simple fingerprint from title + item count + first item content
    const items = d.content?.items || [];
    const firstItem = items[0] ? JSON.stringify(items[0]).slice(0, 100) : '';
    const fingerprint = `${d.title}|${items.length}|${firstItem}`;

    return {
      timestamp: new Date().toISOString(),
      title: d.title || 'Untitled',
      description: d.description || '',
      itemCount: items.length,
      method: d.diagnostics?.extractionMethod || 'unknown',
      cached: d.diagnostics?.servedFromCache || false,
      fingerprint,
    };
  } catch (err: any) {
    console.log(`  ✗ Network error: ${err.message}`);
    return null;
  }
}

function diffSnapshots(prev: Snapshot, curr: Snapshot): string[] {
  const changes: string[] = [];
  if (prev.title !== curr.title) {
    changes.push(`Title: "${prev.title}" → "${curr.title}"`);
  }
  if (prev.itemCount !== curr.itemCount) {
    changes.push(`Items: ${prev.itemCount} → ${curr.itemCount}`);
  }
  if (prev.fingerprint !== curr.fingerprint) {
    changes.push('Content fingerprint changed');
  }
  return changes;
}

async function main() {
  console.log('');
  console.log('Site Monitor Agent');
  console.log('═'.repeat(50));
  console.log(`Target: ${targetUrl}`);
  console.log(`Interval: ${interval}s`);
  console.log(`Checks: ${maxChecks}`);
  console.log('');

  const snapshots: Snapshot[] = [];

  for (let i = 0; i < maxChecks; i++) {
    const checkNum = i + 1;
    console.log(`Check ${checkNum}/${maxChecks} (${new Date().toLocaleTimeString()}):`);

    // Force fresh extraction (bypass cache) to detect changes
    const snapshot = await extractSnapshot(targetUrl, true);
    if (!snapshot) {
      console.log('  Skipping (extraction failed)');
    } else {
      snapshots.push(snapshot);
      console.log(`  ✓ ${snapshot.title}`);
      console.log(`    ${snapshot.itemCount} items via ${snapshot.method}${snapshot.cached ? ' (cached)' : ''}`);

      // Compare with previous snapshot
      if (snapshots.length > 1) {
        const prev = snapshots[snapshots.length - 2];
        const changes = diffSnapshots(prev, snapshot);
        if (changes.length > 0) {
          console.log('  ⚡ CHANGES DETECTED:');
          changes.forEach(c => console.log(`    - ${c}`));
        } else {
          console.log('  — No changes');
        }
      }
    }

    // Wait before next check (skip on last)
    if (i < maxChecks - 1) {
      console.log(`  Waiting ${interval}s...`);
      console.log('');
      await new Promise(r => setTimeout(r, interval * 1000));
    }
  }

  // Summary
  console.log('');
  console.log('═'.repeat(50));
  console.log('Monitor Summary');
  console.log('═'.repeat(50));
  console.log(`  Checks completed: ${snapshots.length}/${maxChecks}`);

  if (snapshots.length >= 2) {
    const first = snapshots[0];
    const last = snapshots[snapshots.length - 1];
    const totalChanges = diffSnapshots(first, last);
    if (totalChanges.length > 0) {
      console.log('  Changes from first to last:');
      totalChanges.forEach(c => console.log(`    - ${c}`));
    } else {
      console.log('  No changes detected across all checks.');
    }
  }

  console.log('');
}

main().catch(err => {
  console.error('Monitor failed:', err.message);
  process.exit(1);
});

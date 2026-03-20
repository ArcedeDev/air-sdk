/**
 * Capability Scout
 *
 * Demonstrates: Capability API + AIR SDK
 *
 * Discovers what actions are possible on any website before
 * visiting it. Shows how an agent can plan its approach by
 * querying the capability graph first.
 *
 * Usage:
 *   npx tsx capability-scout.ts kayak.com amazon.com youtube.com
 *   npx tsx capability-scout.ts --search "book flights"
 */

import 'dotenv/config';

const API_BASE = 'https://api.agentinternetruntime.com';
const API_KEY = process.env.AIR_API_KEY || '';

if (!API_KEY) {
  console.error('Set AIR_API_KEY in .env — get one at agentinternetruntime.com');
  process.exit(1);
}

interface Capability {
  name: string;
  description?: string;
  confidence: number;
  actionType?: string;
  macroAvailable?: boolean;
  entryUrl?: string;
  parameters?: Array<{ name: string; type: string; required: boolean; description?: string }>;
}

async function queryCapabilities(domain: string): Promise<Capability[]> {
  try {
    const res = await fetch(
      API_BASE + '/api/v1/sdk/capabilities?domain=' + encodeURIComponent(domain),
      { headers: { 'Authorization': 'Bearer ' + API_KEY } }
    );
    if (!res.ok) return [];
    const data = await res.json() as any;
    return data.capabilities || [];
  } catch {
    return [];
  }
}

async function searchCapabilities(intent: string): Promise<any[]> {
  try {
    const res = await fetch(API_BASE + '/v1/capabilities', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ intent, limit: 10 }),
    });
    if (!res.ok) return [];
    const data = await res.json() as any;
    return data.capabilities || [];
  } catch {
    return [];
  }
}

function formatCapability(cap: Capability, indent = '  '): string {
  const lines: string[] = [];
  const confidence = Math.round(cap.confidence * 100);
  const macro = cap.macroAvailable ? ' [macro available]' : '';
  lines.push(`${indent}${cap.name} (${confidence}% confidence)${macro}`);

  if (cap.description) {
    lines.push(`${indent}  ${cap.description}`);
  }
  if (cap.entryUrl) {
    lines.push(`${indent}  Entry: ${cap.entryUrl}`);
  }
  if (cap.parameters && cap.parameters.length > 0) {
    lines.push(`${indent}  Params:`);
    cap.parameters.forEach(p => {
      const req = p.required ? '*' : '';
      lines.push(`${indent}    ${p.name}${req} (${p.type})${p.description ? ' — ' + p.description : ''}`);
    });
  }
  return lines.join('\n');
}

async function main() {
  console.log('');
  console.log('Capability Scout');
  console.log('═'.repeat(50));
  console.log('');

  const isSearch = process.argv.includes('--search');

  if (isSearch) {
    // Intent-based search across all domains
    const intent = process.argv.slice(process.argv.indexOf('--search') + 1).join(' ');
    if (!intent) {
      console.error('Usage: npx tsx capability-scout.ts --search "book flights"');
      process.exit(1);
    }

    console.log(`Searching for: "${intent}"`);
    console.log('');

    const results = await searchCapabilities(intent);
    if (results.length === 0) {
      console.log('No capabilities found matching that intent.');
      console.log('The capability graph grows as more sites are extracted.');
    } else {
      console.log(`Found ${results.length} matching capabilities:`);
      console.log('');
      for (const cap of results) {
        console.log(`  ${cap.domain || 'unknown'} → ${cap.capability || cap.name}`);
        if (cap.description) console.log(`    ${cap.description}`);
        if (cap.confidence) console.log(`    Confidence: ${Math.round(cap.confidence * 100)}%`);
        console.log('');
      }
    }
  } else {
    // Domain-specific capability lookup
    const domains = process.argv.slice(2).filter(a => !a.startsWith('-'));
    if (domains.length === 0) {
      console.error('Usage: npx tsx capability-scout.ts domain1.com domain2.com');
      console.error('       npx tsx capability-scout.ts --search "book flights"');
      process.exit(1);
    }

    for (const domain of domains) {
      console.log(`── ${domain} ──`);
      const caps = await queryCapabilities(domain);

      if (caps.length === 0) {
        console.log('  No capabilities indexed yet.');
        console.log('  This domain may not have been extracted. Try:');
        console.log(`    curl -X POST ${API_BASE}/v1/extract \\`);
        console.log(`      -H "Authorization: Bearer $AIR_API_KEY" \\`);
        console.log(`      -d '{"url": "https://${domain}"}'`);
      } else {
        console.log(`  ${caps.length} capabilities found:`);
        console.log('');
        for (const cap of caps) {
          console.log(formatCapability(cap));
          console.log('');
        }
      }
      console.log('');
    }
  }

  // Summary
  console.log('─'.repeat(50));
  console.log('The capability graph expands as more sites are extracted');
  console.log('and more developers use the SDK. Extract a new site:');
  console.log('');
  console.log('  curl -X POST ' + API_BASE + '/v1/extract \\');
  console.log('    -H "Authorization: Bearer $AIR_API_KEY" \\');
  console.log('    -H "Content-Type: application/json" \\');
  console.log('    -d \'{"url": "https://example.com"}\'');
  console.log('');
}

main().catch(err => {
  console.error('Scout failed:', err.message);
  process.exit(1);
});

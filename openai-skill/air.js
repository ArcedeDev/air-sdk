#!/usr/bin/env node
/**
 * AIR SDK — Thin CLI Client for OpenAI Hosted Shell
 *
 * Zero dependencies. Uses Node.js built-in fetch (Node 18+).
 * Reads $AIR_API_KEY from environment (injected via domain_secrets).
 *
 * Usage:
 *   node air.js browse <domain>
 *   node air.js extract <url>
 *   node air.js execute <domain> <capability> [params_json]
 *   node air.js report <domain> <capability> <success> [steps_json]
 */

const VERSION = '1.0.0';
const API_BASE = 'https://api.agentinternetruntime.com';
const API_KEY = process.env.AIR_API_KEY;

// ── Request helper ──

async function request(method, path, body) {
  const url = `${API_BASE}${path}`;
  const hdrs = {
    'Authorization': `Bearer ${API_KEY}`,
    'User-Agent': `AIR-SDK-OpenAI-Skill/${VERSION}`,
  };
  if (body) hdrs['Content-Type'] = 'application/json';

  const opts = { method, headers: hdrs, signal: AbortSignal.timeout(30000) };
  if (body) opts.body = JSON.stringify(body);

  let res;
  try {
    res = await fetch(url, opts);
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      fatal(`Request timed out after 30s: ${method} ${path}`);
    }
    fatal(`Network error: ${err.message}`);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    // Non-JSON response (502, HTML error page, etc.)
    fatal(`API returned non-JSON response (HTTP ${res.status}). The service may be temporarily unavailable.`);
  }

  if (!res.ok) {
    fatal(`API error (${res.status}): ${data.error || data.message || 'Unknown error'}`);
  }

  return data;
}

function fatal(message) {
  console.error(JSON.stringify({ error: true, message }));
  process.exit(1);
}

function parseJson(str, label) {
  try {
    return JSON.parse(str);
  } catch {
    fatal(`Invalid JSON for ${label}. Make sure it's valid JSON (e.g., '{"key":"value"}' or '[{...}]').`);
  }
}

// ── Commands ──

async function browse(domain) {
  if (!domain) fatal('Missing required argument: domain. Usage: air.js browse <domain>');

  const data = await request('GET', `/api/v1/sdk/capabilities?domain=${encodeURIComponent(domain)}&include=execution`);
  const caps = data.capabilities || [];

  console.log(JSON.stringify({
    domain,
    total: caps.length,
    capabilities: caps.map(c => ({
      name: c.capability || c.name,
      description: c.description,
      confidence: c.confidence,
      executionTier: c.execution_tier || c.executionTier || 'description_only',
      macroAvailable: c.has_desktop_macro || c.macroAvailable || false,
      entryUrl: c.entry_url || c.entryUrl || null,
      selector: c.selector || null,
    })),
  }, null, 2));
}

async function extract(url) {
  if (!url) fatal('Missing required argument: url. Usage: air.js extract <url>');

  const data = await request('POST', '/api/v1/extract', { url });

  if (!data.success) {
    fatal(`Extraction failed: ${data.error || data.message || 'Unknown error'}`);
  }

  console.log(JSON.stringify({
    success: data.success,
    title: data.data?.title,
    description: data.data?.description,
    extractionMethod: data.data?.diagnostics?.extractionMethod,
    confidence: data.data?.diagnostics?.confidenceScore,
    itemCount: data.data?.diagnostics?.itemsExtracted || data.data?.content?.items?.length || 0,
    credits: { used: data.credits_used, remaining: data.credits_remaining },
    items: (data.data?.content?.items || []).slice(0, 20),
  }, null, 2));
}

async function execute(domain, capability, paramsJson) {
  if (!domain) fatal('Missing required argument: domain. Usage: air.js execute <domain> <capability> [params_json]');
  if (!capability) fatal('Missing required argument: capability. Usage: air.js execute <domain> <capability> [params_json]');

  const params = paramsJson ? parseJson(paramsJson, 'params') : {};

  const capsData = await request('GET', `/api/v1/sdk/capabilities?domain=${encodeURIComponent(domain)}&include=execution`);
  const caps = capsData.capabilities || [];
  const cap = caps.find(c => (c.capability || c.name) === capability);

  if (!cap) {
    console.log(JSON.stringify({
      domain,
      capability,
      executionTier: 'description_only',
      note: `"${capability}" is not indexed for ${domain}. Use your browser tools and report the outcome.`,
      startUrl: `https://${domain}`,
      params,
    }, null, 2));
    return;
  }

  const tier = cap.execution_tier || cap.executionTier || 'description_only';
  const entryUrl = cap.entry_url || cap.entryUrl || `https://${domain}`;
  const fallbacks = cap.fallback_selectors || cap.fallbackSelectors || [];

  const result = {
    domain,
    capability,
    executionTier: tier,
    confidence: cap.confidence,
    entryUrl,
    selector: cap.selector || null,
    fallbackSelectors: fallbacks,
    macroAvailable: cap.has_desktop_macro || cap.macroAvailable || false,
    description: cap.description,
    params,
  };

  if (tier === 'selector_guided' || tier === 'macro_verified') {
    result.instructions = `Use selector "${cap.selector}" on ${entryUrl}. Fallbacks: ${fallbacks.join(', ') || 'none'}`;
  } else {
    result.instructions = `Navigate to ${entryUrl} and perform "${capability}" using your browser tools.`;
  }

  console.log(JSON.stringify(result, null, 2));
}

async function report(domain, capability, success, stepsJson) {
  if (!domain) fatal('Missing required argument: domain. Usage: air.js report <domain> <capability> <success> [steps_json]');
  if (!capability) fatal('Missing required argument: capability.');
  if (success === undefined) fatal('Missing required argument: success (true or false).');

  const steps = stepsJson ? parseJson(stepsJson, 'steps') : [];
  const isSuccess = success === 'true' || success === true;

  await request('POST', '/api/v1/sdk/telemetry', {
    events: [{
      domain,
      path: null,
      actionSequence: steps.map(s => ({
        type: s.action || 'unknown',
        selector: s.selector || null,
        value: s.value ? '[REDACTED]' : null,
        success: s.success !== false,
        durationMs: 0,
      })),
      sessionOutcome: isSuccess ? 'success' : 'failure',
      macroId: null,
      macroVersion: null,
      macroSucceeded: null,
      recoverySequence: null,
      browserInfo: { framework: 'openai_skill', headless: false, frameworkVersion: VERSION },
      pageSignals: { capability, executionPath: 'openai_skill' },
      executionTimeMs: 0,
    }],
  });

  const selectorCount = steps.filter(s => s.selector).length;
  console.log(JSON.stringify({
    reported: true,
    domain,
    capability,
    success: isSuccess,
    stepsReported: steps.length,
    selectorsIncluded: selectorCount,
    note: selectorCount > 0
      ? 'Report accepted. Your selectors will be used for macro synthesis.'
      : 'Report accepted but no CSS selectors were included. Include selectors for maximum value.',
  }, null, 2));
}

// ── Entrypoint ──

const COMMANDS = { browse, extract, execute, report };
const [,, command, ...args] = process.argv;

if (command === '--version' || command === '-v') {
  console.log(`air-sdk-skill v${VERSION}`);
  process.exit(0);
}

if (command === '--help' || command === '-h' || !command || !COMMANDS[command]) {
  const isUnknown = command && !['--help', '-h', '--version', '-v'].includes(command);
  if (isUnknown) console.error(`Unknown command: "${command}"\n`);

  console.error(`AIR SDK v${VERSION} — Web Intelligence for AI Agents

Usage:
  node air.js browse <domain>                              Discover site capabilities
  node air.js extract <url>                                Extract structured data
  node air.js execute <domain> <capability> [params_json]  Get execution plan
  node air.js report <domain> <capability> <success> [steps_json]  Report outcome
  node air.js --version                                    Print version
  node air.js --help                                       Show this help

Environment:
  AIR_API_KEY    Required. Get one at https://agentinternetruntime.com/extract/dashboard/sdk

Examples:
  node air.js browse amazon.com
  node air.js extract "https://news.ycombinator.com"
  node air.js execute kayak.com search_flights '{"origin":"NYC","destination":"Tokyo"}'
  node air.js report amazon.com search_products true '[{"action":"click","selector":"#search","success":true}]'`);
  process.exit(isUnknown ? 1 : 0);
}

if (!API_KEY) {
  fatal('AIR_API_KEY environment variable is not set. Get a free key at: https://agentinternetruntime.com/extract/dashboard/sdk');
}

COMMANDS[command](...args).catch(err => {
  fatal(err.message || String(err));
});

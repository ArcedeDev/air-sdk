// ============================================================
// AIR SDK — MCP Tool Definitions & Handlers
//
// Every tool call fires implicit telemetry (demand signals).
// Rich execution intelligence is surfaced when available.
// ============================================================

import type { CapabilityCache } from '../core/capability-cache';
import type { AIRHttpClient } from '../core/http';
import type { Capability, Macro, MacroStep } from '../core/types';

// ---- MCP Result Type ----

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

// ---- Tool Schemas (JSON Schema for MCP tools/list) ----

export const tools = [
  {
    name: 'extract_url',
    description:
      'Extract structured data from any URL. Returns title, description, content items, ' +
      'metadata, and diagnostics. Handles SPAs (YouTube, Next.js, Nuxt), JSON-LD, and ' +
      'standard meta tags. Costs 1.0 credit (fresh) or 0.1 credit (cached).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string',
          description: 'The URL to extract data from (e.g., "https://example.com/page")',
        },
        force: {
          type: 'boolean',
          description: 'Bypass cache for fresh extraction (default: false, uses cache when available)',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'browse_capabilities',
    description:
      'Step 1 of 3: Discover what actions can be automated on a website domain. Returns capabilities ' +
      '(search, login, add to cart, etc.) with confidence scores, execution tiers, selectors, ' +
      'and macro availability. Always follow up with execute_capability (step 2) and report_outcome (step 3).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        domain: {
          type: 'string',
          description: 'Website domain to check (e.g., "kayak.com", "amazon.com")',
        },
      },
      required: ['domain'],
    },
  },
  {
    name: 'execute_capability',
    description:
      'Step 2 of 3: Get execution guidance for a specific capability. Returns the optimal path: ' +
      'API fast-path, pre-verified macro steps, selector hints, or context for unverified capabilities. ' +
      'Call this after browse_capabilities. After executing with your browser tools, you MUST call ' +
      'report_outcome (step 3) with the CSS selectors you used.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        domain: {
          type: 'string',
          description: 'Website domain (e.g., "kayak.com")',
        },
        capability: {
          type: 'string',
          description: 'Capability name (e.g., "search_flights")',
        },
        params: {
          type: 'object',
          description:
            'Parameters for the capability (e.g., { "destination": "Tokyo", "date": "2026-04-01" })',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['domain', 'capability', 'params'],
    },
  },
  {
    name: 'report_outcome',
    description:
      'REQUIRED: Report the outcome after executing ANY browser action via AIR. ' +
      'This is the final step of every browse → execute → report workflow. ' +
      'Without your report, the action you just performed is lost — no macro gets created, no future agent benefits. ' +
      'You MUST include the exact CSS selectors you used in each step. Steps with empty selectors are discarded. ' +
      'Example steps: [{ action: "click", selector: "input#twotabsearchtextbox", success: true }, ' +
      '{ action: "fill", selector: "input#twotabsearchtextbox", value: "query", success: true }, ' +
      '{ action: "click", selector: "input#nav-search-submit-button", success: true }]. ' +
      'Look at the CSS selectors from your browser tool calls and copy them exactly into each step.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        domain: {
          type: 'string',
          description: 'Website domain where the action was performed (e.g., "youtube.com")',
        },
        capability: {
          type: 'string',
          description: 'What capability was performed (e.g., "search_videos", "fill_form")',
        },
        success: {
          type: ['boolean', 'string'],
          description: 'Whether the action completed successfully (true/false or "true"/"false")',
        },
        steps: {
          type: 'array',
          description: 'The steps you took (action + selector pairs)',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string', description: 'Action type: click, fill, press, navigate, etc.' },
              selector: { type: 'string', description: 'CSS selector you used for this step' },
              airProvidedSelector: { type: 'string', description: 'The selector AIR suggested (if different from what you used)' },
              selectorMatched: { type: ['boolean', 'string'], description: 'Whether AIR\'s suggested selector worked' },
              fallbackUsed: { type: 'string', description: 'The fallback selector that actually worked (if AIR\'s failed)' },
              value: { type: 'string', description: 'Value entered (for fill/type actions)' },
              success: { type: ['boolean', 'string'], description: 'Whether this step succeeded' },
            },
            required: ['action', 'success'],
          },
        },
        requestId: {
          type: 'string',
          description: 'The request ID from execute_capability (e.g., "air_abc123xyz789"). Links your report to the execution context.',
        },
        executionTier: {
          type: 'string',
          description: 'Which tier of AIR guidance you relied on (api_direct, macro_verified, selector_guided, url_only, description_only)',
        },
        executionPath: {
          type: 'string',
          description: 'How you got your execution instructions: "execute_capability" (used the structured plan), "browse_direct" (used selectors from browse_capabilities), or "manual" (found your own approach)',
        },
        notes: {
          type: 'string',
          description: 'Any additional context about the execution (errors encountered, fallback selectors used, etc.)',
        },
      },
      required: ['domain', 'capability', 'success'],
    },
  },
] as const;

// ---- Implicit Telemetry Helper ----

/**
 * Fire a lightweight telemetry event for every tool invocation.
 * Non-blocking — never delays the tool response.
 */
function logToolInteraction(
  httpClient: AIRHttpClient,
  tool: string,
  domain: string | undefined,
  resultSummary: { hit: boolean; count?: number; tier?: string; query?: string }
): void {
  httpClient.post('/api/v1/sdk/telemetry', {
    events: [{
      domain: domain || 'unknown',
      sessionOutcome: resultSummary.hit ? 'capability_hit' : 'capability_miss',
      pageSignals: {
        toolName: tool,
        resultHit: resultSummary.hit,
        resultCount: resultSummary.count ?? 0,
        bestExecutionTier: resultSummary.tier ?? null,
        searchQuery: resultSummary.query ?? null,
        timestamp: new Date().toISOString(),
      },
      browserInfo: { framework: 'other', headless: false, frameworkVersion: 'unknown' },
      executionTimeMs: 0,
    }],
  }).catch(() => {}); // fire and forget
}

// ---- Handlers ----

/**
 * Route an MCP tools/call request to the appropriate handler.
 * Returns a valid MCP CallToolResult.
 */
export async function handleToolCall(
  toolName: string,
  args: Record<string, unknown> | undefined,
  cache: CapabilityCache,
  httpClient: AIRHttpClient
): Promise<McpToolResult> {
  try {
    switch (toolName) {
      case 'extract_url':
        return await handleExtractUrl(args, httpClient);
      case 'browse_capabilities':
        return await handleBrowseCapabilities(args, cache, httpClient);
      case 'search_capabilities':
        return errorResult('search_capabilities has been removed. Use browse_capabilities with a specific domain instead.');
      case 'execute_capability':
        return await handleExecuteCapability(args, cache, httpClient);
      case 'report_outcome':
        return await handleReportOutcome(args, httpClient);
      default:
        return errorResult(`Unknown tool: ${toolName}`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(`Tool "${toolName}" failed: ${message}`);
  }
}

// ---- extract_url ----

interface ExtractApiResponse {
  success: boolean;
  data?: {
    title?: string;
    description?: string;
    url?: string;
    content?: { type?: string; items?: unknown[] };
    diagnostics?: {
      extractionMethod?: string;
      confidenceScore?: number;
      itemsExtracted?: number;
      extractionTimeMs?: number;
      servedFromCache?: boolean;
      cacheAge?: number;
    };
  };
  credits_used?: number;
  credits_remaining?: number;
  error?: string;
  message?: string;
}

async function handleExtractUrl(
  args: Record<string, unknown> | undefined,
  httpClient: AIRHttpClient
): Promise<McpToolResult> {
  const url = args?.url as string | undefined;
  if (!url) {
    return errorResult('Missing required parameter: url');
  }

  const force = (args?.force as boolean) ?? false;

  let response: ExtractApiResponse;
  try {
    response = await httpClient.post<ExtractApiResponse>('/api/v1/extract', {
      url,
      options: force ? { force: true } : {},
    });
  } catch {
    return errorResult(
      `Extraction failed for "${url}". The extract API may be unavailable or the URL is invalid.`
    );
  }

  if (!response.success || !response.data) {
    return errorResult(
      `Extraction failed: ${response.error || response.message || 'Unknown error'}`
    );
  }

  const d = response.data;
  const diag = d.diagnostics;
  const itemCount = diag?.itemsExtracted ?? d.content?.items?.length ?? 0;

  // Fire demand signal: successful extraction on this domain
  try {
    const extractDomain = new URL(url).hostname.replace(/^www\./, '');
    logToolInteraction(httpClient, 'extract_url', extractDomain, {
      hit: true,
      count: itemCount,
      tier: 'extraction_confirmed',
    });
  } catch {
    // URL parsing failed — skip telemetry
  }

  const lines = [
    `## ${d.title || 'Untitled'}`,
    '',
  ];

  if (d.description) {
    lines.push(d.description);
    lines.push('');
  }

  lines.push(`**URL:** ${d.url || url}`);
  lines.push(`**Extraction method:** ${diag?.extractionMethod || 'unknown'}`);
  lines.push(`**Confidence:** ${diag?.confidenceScore !== undefined ? (diag.confidenceScore * 100).toFixed(0) + '%' : 'unknown'}`);
  lines.push(`**Items extracted:** ${itemCount}`);
  lines.push(`**Time:** ${diag?.extractionTimeMs || 0}ms`);

  if (diag?.servedFromCache) {
    lines.push(`**Cache:** hit (${diag.cacheAge ?? 0}s old)`);
  }

  if (response.credits_used !== undefined) {
    lines.push(`**Credits:** ${response.credits_used} used | ${response.credits_remaining ?? '?'} remaining`);
  }

  // Include content summary
  if (d.content?.items && Array.isArray(d.content.items) && d.content.items.length > 0) {
    lines.push('');
    lines.push('### Content');
    lines.push('```json');
    // Truncate to avoid overwhelming the context window
    const preview = d.content.items.slice(0, 10);
    lines.push(JSON.stringify(preview, null, 2));
    if (d.content.items.length > 10) {
      lines.push(`\n... and ${d.content.items.length - 10} more items`);
    }
    lines.push('```');
  }

  return textResult(lines.join('\n'));
}

// ---- browse_capabilities ----

async function handleBrowseCapabilities(
  args: Record<string, unknown> | undefined,
  cache: CapabilityCache,
  httpClient: AIRHttpClient
): Promise<McpToolResult> {
  const domain = args?.domain as string | undefined;
  if (!domain) {
    return errorResult('Missing required parameter: domain');
  }

  const capabilities = await cache.getCapabilities(domain);

  if (capabilities.length === 0) {
    // Fire demand signal — domain requested but no data available
    logToolInteraction(httpClient, 'browse_capabilities', domain, {
      hit: false,
      count: 0,
    });

    return textResult(
      `No indexed capabilities found for "${domain}" yet.\n\n` +
        'AIR has registered your interest — this domain will be prioritized for capability discovery.\n\n' +
        'You can still proceed:\n' +
        `- **Call \`execute_capability\`** with the action you want (e.g., "search", "add_to_cart") — AIR will generate a heuristic execution plan\n` +
        `- **Use \`extract_url\`** to get structured data from specific URLs on ${domain}\n\n` +
        'After executing, call `report_outcome` — your report creates the first capability entry for this domain.'
    );
  }

  // Sort by execution quality: best tier first, then highest confidence
  const tierRank: Record<string, number> = { api_direct: 0, macro_verified: 1, selector_guided: 2, url_only: 3, description_only: 4 };
  const sorted = [...capabilities].sort((a, b) => {
    const ta = tierRank[a.executionTier || 'description_only'] ?? 4;
    const tb = tierRank[b.executionTier || 'description_only'] ?? 4;
    if (ta !== tb) return ta - tb;
    return b.confidence - a.confidence;
  });

  const bestTier = sorted[0].executionTier || 'description_only';

  // Fire demand signal — domain requested, data found
  logToolInteraction(httpClient, 'browse_capabilities', domain, {
    hit: true,
    count: capabilities.length,
    tier: bestTier,
  });

  const COMPACT_THRESHOLD = 10;
  const FEATURED_COUNT = 3;
  const useCompact = sorted.length > COMPACT_THRESHOLD;

  const lines = [
    `## Capabilities for ${domain}`,
    `Found ${sorted.length} capability${sorted.length !== 1 ? 'ies' : 'y'}:`,
    '',
  ];

  if (useCompact) {
    // Domain summary — tier distribution ordered by quality (best first)
    const tierGroups: Record<string, number> = {};
    for (const cap of sorted) {
      const t = cap.executionTier || 'description_only';
      tierGroups[t] = (tierGroups[t] || 0) + 1;
    }
    const tierOrder = ['api_direct', 'macro_verified', 'selector_guided', 'url_only', 'description_only'];
    const summary = tierOrder
      .filter(t => tierGroups[t])
      .map(t => `${tierGroups[t]} ${formatTierLabel(t)}`)
      .join(', ');
    lines.push(`**Quality breakdown:** ${summary}`);
    lines.push('');

    // Full detail for top N — Claude can freestyle with these
    const featured = sorted.slice(0, FEATURED_COUNT);
    lines.push(`### Top ${featured.length} — Full Detail`);
    lines.push('');
    for (const cap of featured) {
      renderCapabilityDetail(cap, lines);
    }

    // Compact catalog for the rest — no duplication with featured
    const rest = sorted.slice(FEATURED_COUNT);
    lines.push(`### Other Capabilities (${rest.length})`);
    lines.push('');
    for (const cap of rest) {
      const pct = (cap.confidence * 100).toFixed(0);
      const tier = formatTierLabel(cap.executionTier || 'description_only');
      const desc = cap.description ? ` — ${cap.description}` : '';
      const warn = (cap.authRequirement && cap.authRequirement !== 'none') ? ' ⚠️ auth' : '';
      lines.push(`- **${cap.name}** (${tier}, ${pct}%${warn})${desc}`);
    }
    lines.push('');
  } else {
    // Small domain — full detail for everything
    for (const cap of sorted) {
      renderCapabilityDetail(cap, lines);
    }
  }

  // CTA — 3-step workflow: browse → execute → report
  lines.push('---');
  lines.push('### Workflow: browse → execute → report');
  if (useCompact) {
    lines.push(`1. **Execute:** Call \`execute_capability\` with any capability name above to get a step-by-step execution plan.`);
    lines.push(`   The top ${FEATURED_COUNT} above include full detail for immediate use.`);
  } else {
    lines.push('1. **Execute:** Call `execute_capability` with the capability name and your parameters for a step-by-step plan.');
  }
  lines.push('2. **Perform:** Use your browser tools to carry out the steps.');
  lines.push('3. **Report (required):** Call `report_outcome` with the CSS selectors you used and whether each step succeeded. Without this, your work is lost — no macro is created for future agents.');

  return textResult(lines.join('\n'));
}

// ---- Capability Rendering Helpers ----

/**
 * Render a single capability with full execution detail.
 * Used in browse_capabilities (for all caps when ≤10, or top N when >10)
 * and keeps the rendering logic in one place.
 */
function renderCapabilityDetail(cap: Capability, lines: string[]): void {
  const confidence = (cap.confidence * 100).toFixed(0);
  const tier = cap.executionTier || 'description_only';
  const tierLabel = formatTierLabel(tier);

  lines.push(`### ${cap.name}`);
  if (cap.description) lines.push(cap.description);

  // Confidence reflects "how sure we are this capability exists" — tier reflects execution readiness
  if (tier === 'description_only' || tier === 'url_only') {
    lines.push(`- **Tier:** ${tierLabel}  |  **Discovery confidence:** ${confidence}%`);
    if (tier === 'description_only') {
      lines.push(`- ℹ️ No verified selectors yet — call \`execute_capability\` for a structured plan, then \`report_outcome\` with the selectors you used`);
    }
  } else {
    lines.push(`- **Tier:** ${tierLabel}  |  **Confidence:** ${confidence}%`);
  }

  // API fast-path (Tier 1)
  if (cap.apiEndpoint) {
    lines.push(`- **API fast-path:** \`${cap.apiMethod || 'GET'} ${cap.apiEndpoint}\` — skip the browser entirely`);
  }

  // Macro availability
  if (cap.macroAvailable) {
    lines.push(`- **Macro:** ✅ Available${cap.macroId ? ` (\`${cap.macroId}\`)` : ''}`);
  } else if (cap.executionMacro) {
    lines.push('- **Macro:** ✅ Desktop-verified playbook available');
  }

  // Selectors
  if (cap.selector) {
    lines.push(`- **Primary selector:** \`${cap.selector}\``);
    if (cap.fallbackSelectors?.length) {
      lines.push(`- **Fallback selectors:** ${cap.fallbackSelectors.map(s => `\`${s}\``).join(', ')}`);
    }
  }

  // Navigation
  if (cap.navigationUrlTemplate) {
    lines.push(`- **Navigate to:** ${cap.navigationUrlTemplate}`);
  } else if (cap.entryUrl) {
    lines.push(`- **Entry URL:** ${cap.entryUrl}`);
  }

  // Pre-flight warnings
  if (cap.authRequirement && cap.authRequirement !== 'none') {
    lines.push(`- ⚠️ **Auth required:** ${cap.authRequirement}`);
  }
  if (cap.executionEnginePolicy === 'blocks_headless') {
    lines.push('- ⚠️ **This site blocks headless browsers** — use headed mode');
  }

  // Validation quality
  if (cap.validationStats && cap.validationStats.attempts > 0) {
    const rate = (cap.validationStats.rate * 100).toFixed(0);
    lines.push(`- **Validation:** ${cap.validationStats.successes}/${cap.validationStats.attempts} successes (${rate}%)`);
  }
  if (cap.promotionState) {
    lines.push(`- **Status:** ${cap.promotionState.replace(/_/g, ' ')}`);
  }

  // Parameters
  if (cap.parameters?.length) {
    lines.push('- **Parameters:**');
    for (const p of cap.parameters) {
      const req = p.required ? ' *(required)*' : '';
      lines.push(`  - \`${p.name}\` (${p.type})${req}: ${p.description}`);
    }
  }

  // Extraction rules hint
  if (cap.extractionRules) {
    lines.push('- **Extraction rules:** Available — structured data extraction patterns provided');
  }

  if (cap.mppPricing) {
    lines.push(`- **Cost:** $${cap.mppPricing.perRequest} per request (${cap.mppPricing.protocol.toUpperCase()})`);
  }

  lines.push('');
}

// ---- execute_capability ----

async function handleExecuteCapability(
  args: Record<string, unknown> | undefined,
  cache: CapabilityCache,
  httpClient: AIRHttpClient
): Promise<McpToolResult> {
  const domain = args?.domain as string | undefined;
  const capability = args?.capability as string | undefined;
  const params = (args?.params ?? {}) as Record<string, string>;

  if (!domain) return errorResult('Missing required parameter: domain');
  if (!capability) return errorResult('Missing required parameter: capability');

  // Fetch the capability metadata first for entryUrl context
  const capabilities = await cache.getCapabilities(domain);
  const capMeta = capabilities.find(c => c.name === capability);

  // Fire demand signal — execution attempted
  logToolInteraction(httpClient, 'execute_capability', domain, {
    hit: !!capMeta,
    count: 1,
    tier: capMeta?.executionTier,
  });

  const macro = await cache.getMacroForCapability(domain, capability);

  // Generate a request ID for cross-request correlation.
  // This links execute_capability → report_outcome in telemetry.
  const requestId = generateRequestId();

  // ---- Path 1: API fast-path (skip browser entirely) ----
  if (capMeta?.apiEndpoint) {
    const lines = [
      `## API Fast-Path: ${capability} on ${domain}`,
      `**Execution tier:** api_direct ⚡`,
      `**Request ID:** \`${requestId}\``,
      '',
      '**You can skip the browser entirely:**',
      `- **Endpoint:** \`${capMeta.apiMethod || 'GET'} ${capMeta.apiEndpoint}\``,
      '',
    ];

    if (capMeta.parameters?.length) {
      lines.push('### Parameters');
      for (const p of capMeta.parameters) {
        const val = params[p.name];
        lines.push(`- **${p.name}** (${p.type})${p.required ? ' *required*' : ''}: ${val ? `"${val}"` : 'not provided'}`);
      }
      lines.push('');
    }

    addPreFlightWarnings(lines, capMeta);

    lines.push('---');
    lines.push(`**Required:** After executing, call \`report_outcome\` with \`requestId: "${requestId}"\` to keep this capability verified.`);

    return textResult(lines.join('\n'));
  }

  // ---- Path 2: Verified SDK macro ----
  if (macro) {
    const stepCount = macro.steps.length;
    const lines = [
      `## Macro: ${capability} on ${domain}`,
      `**Execution tier:** macro_verified ✅`,
      `**Request ID:** \`${requestId}\``,
      `**Version:** ${macro.version}  |  **Confidence:** ${(macro.confidence * 100).toFixed(0)}%  |  **Steps:** ${stepCount}`,
      '',
    ];

    if (capMeta?.entryUrl) {
      lines.push(`**Start URL:** ${capMeta.entryUrl}`);
      lines.push('');
    }

    addPreFlightWarnings(lines, capMeta);

    lines.push('Execute the following steps in order using your browser tools:');
    lines.push('');

    for (let i = 0; i < stepCount; i++) {
      lines.push(formatStep(i + 1, macro.steps[i], params));
    }

    lines.push('');
    lines.push('---');
    lines.push(`*Macro ID: \`${macro.id}\` (v${macro.version}). Last verified: ${macro.lastVerifiedAt ?? 'unknown'}.*`);
    lines.push('');
    lines.push(`**Required:** After executing, call \`report_outcome\` with \`requestId: "${requestId}"\` and which selectors worked, which failed, and any fallbacks you discovered.`);

    return textResult(lines.join('\n'));
  }

  // ---- Path 3: Desktop execution macro (not in sdk_macros, but Desktop has playbook) ----
  if (capMeta?.executionMacro) {
    const lines = [
      `## Desktop Playbook: ${capability} on ${domain}`,
      `**Execution tier:** macro_verified ✅ (Desktop-sourced)`,
      `**Request ID:** \`${requestId}\``,
      `**Confidence:** ${(capMeta.confidence * 100).toFixed(0)}%`,
      '',
    ];

    const navUrl = capMeta.navigationUrlTemplate || capMeta.searchUrlTemplate || capMeta.entryUrl;
    if (navUrl) {
      lines.push(`**Start URL:** ${navUrl}`);
      lines.push('');
    }

    addPreFlightWarnings(lines, capMeta);

    lines.push('### Execution Macro');
    lines.push('```');
    lines.push(typeof capMeta.executionMacro === 'string' ? capMeta.executionMacro : JSON.stringify(capMeta.executionMacro, null, 2));
    lines.push('```');
    lines.push('');

    if (capMeta.extractionRules) {
      lines.push('### Extraction Rules');
      lines.push('```json');
      lines.push(JSON.stringify(capMeta.extractionRules, null, 2));
      lines.push('```');
      lines.push('');
    }

    if (capMeta.parameters?.length) {
      lines.push('### Parameters');
      for (const p of capMeta.parameters) {
        const val = params[p.name];
        lines.push(`- **${p.name}** (${p.type})${p.required ? ' *required*' : ''}: ${val ? `"${val}"` : 'not provided'}`);
      }
      lines.push('');
    }

    lines.push('---');
    lines.push(`**Required:** After executing, call \`report_outcome\` with \`requestId: "${requestId}"\` and which selectors worked, which failed, and any fallbacks you discovered.`);

    return textResult(lines.join('\n'));
  }

  // ---- Path 4: Selector-guided (no macro, but we know the selectors) ----
  if (capMeta?.selector) {
    const lines = [
      `## Selector-Guided: ${capability} on ${domain}`,
      `**Execution tier:** selector_guided 🎯`,
      `**Request ID:** \`${requestId}\``,
      `**Confidence:** ${(capMeta.confidence * 100).toFixed(0)}%`,
      '',
    ];

    const navUrl = capMeta.navigationUrlTemplate || capMeta.searchUrlTemplate || capMeta.entryUrl;
    if (navUrl) {
      lines.push(`**Start URL:** ${navUrl}`);
    }

    lines.push('');
    addPreFlightWarnings(lines, capMeta);

    lines.push('### Target Element');
    lines.push(`- **Primary selector:** \`${capMeta.selector}\``);
    if (capMeta.fallbackSelectors?.length) {
      lines.push('- **Fallback selectors** (try in order if primary fails):');
      for (const fb of capMeta.fallbackSelectors) {
        lines.push(`  - \`${fb}\``);
      }
    }
    lines.push('');

    if (capMeta.parameters?.length) {
      lines.push('### Parameters');
      for (const p of capMeta.parameters) {
        const val = params[p.name];
        lines.push(`- **${p.name}** (${p.type})${p.required ? ' *required*' : ''}: ${val ? `"${val}"` : 'not provided'}`);
      }
      lines.push('');
    }

    lines.push('### Suggested Approach');
    lines.push(`1. Navigate to ${navUrl || `https://${domain}`}`);
    lines.push(`2. Find the element using the primary selector \`${capMeta.selector}\``);
    lines.push(`3. Perform the "${capability}" action`);
    lines.push(`4. **Required:** Call \`report_outcome\` with \`requestId: "${requestId}"\` and the CSS selectors you used`);
    lines.push('');

    if (capMeta.extractionRules) {
      lines.push('### Extraction Rules');
      lines.push('```json');
      lines.push(JSON.stringify(capMeta.extractionRules, null, 2));
      lines.push('```');
      lines.push('');
    }

    return textResult(lines.join('\n'));
  }

  // ---- Path 5: URL-only or description-only — hints, not a plan ----
  // The LLM is smart enough to figure out how to interact with a website.
  // AIR provides: context, metadata, entry points, and a request ID to correlate the report.
  const navUrl = capMeta?.navigationUrlTemplate || capMeta?.searchUrlTemplate || capMeta?.entryUrl || `https://${domain}`;
  const tier = capMeta?.entryUrl ? 'url_only' : 'description_only';

  const lines = [
    `## ${capability} on ${domain}`,
    `**Execution tier:** ${tier} 📄 (no verified macro yet — your report creates one)`,
    `**Request ID:** \`${requestId}\``,
    '',
  ];

  if (capMeta?.description) {
    lines.push(capMeta.description);
    lines.push('');
  }

  addPreFlightWarnings(lines, capMeta);

  // Hints — not a plan. Give the LLM what AIR knows and let it figure out the rest.
  lines.push('### What AIR knows');
  lines.push(`- **Start here:** \`${navUrl}\``);

  if (capMeta?.parameters?.length) {
    for (const p of capMeta.parameters) {
      const val = params[p.name];
      lines.push(`- **${p.name}** (${p.type})${p.required ? ' *required*' : ''}: ${val ? `"${val}"` : 'not provided'}`);
    }
  } else if (Object.keys(params).length > 0) {
    for (const [key, value] of Object.entries(params)) {
      lines.push(`- **${key}:** "${value}"`);
    }
  }

  if (!capMeta?.authRequirement || capMeta.authRequirement === 'none') {
    lines.push('- No authentication required');
  }

  lines.push('');
  lines.push('Use your browser tools to perform this action however you see fit. ' +
    'AIR has no verified approach for this yet — you are the first agent to attempt it.');
  lines.push('');

  if (!capMeta) {
    lines.push(`> "${capability}" is not yet indexed for ${domain}. ` +
      'Your report below will create the first capability entry for this domain.');
    lines.push('');
  }

  // Mandatory report_outcome — the critical handoff
  lines.push('---');
  lines.push('### ⚠️ Required: Report Your Results');
  lines.push('');
  lines.push('After you finish, call `report_outcome` with the **CSS selectors you used** for each step. ' +
    'This is how AIR learns — your selectors become the verified macro for all future agents.');
  lines.push('');
  lines.push('```');
  lines.push('report_outcome({');
  lines.push(`  domain: "${domain}",`);
  lines.push(`  capability: "${capability}",`);
  lines.push('  success: true/false,');
  lines.push(`  requestId: "${requestId}",`);
  lines.push(`  executionTier: "${tier}",`);
  lines.push('  executionPath: "execute_capability",');
  lines.push('  steps: [');
  lines.push('    { action: "navigate", selector: "", success: true },');
  lines.push('    { action: "click", selector: "#the-css-selector", success: true },');
  lines.push('    { action: "fill", selector: "input.search", value: "query", success: true },');
  lines.push('    // Include every interaction with its CSS selector');
  lines.push('  ]');
  lines.push('})');
  lines.push('```');

  return textResult(lines.join('\n'));
}

/**
 * Format a single macro step into a human/AI-readable instruction.
 */
function formatStep(
  index: number,
  step: MacroStep,
  params: Record<string, string>
): string {
  const parts: string[] = [];

  // Action verb
  const verb = actionVerb(step.action);
  parts.push(`**Step ${index}.** ${verb}`);

  // For navigate actions, prefer the URL over the selector
  if (step.action === 'navigate' && step.paramsKey) {
    // URL will come from params rendering below
  } else if (step.selector) {
    parts.push(`\`${step.selector}\``);
  }

  // Value from params
  if (step.paramsKey) {
    const value = params[step.paramsKey];
    if (value) {
      parts.push(`with value **"${value}"**`);
    } else {
      parts.push(`with value from \`params.${step.paramsKey}\``);
    }
  }

  let line = parts.join(' ');

  // Description
  if (step.description) {
    line += ` — *${step.description}*`;
  }

  // Fallback selectors as sub-bullets
  if (step.fallbackSelectors?.length) {
    line += '\n' + step.fallbackSelectors
      .map(s => `   - Fallback: \`${s}\``)
      .join('\n');
  }

  // Wait instructions
  if (step.waitMs) {
    line += `\n   - Wait ${step.waitMs}ms after this step`;
  }
  if (step.waitForSelector) {
    line += `\n   - Wait for \`${step.waitForSelector}\` to appear`;
  }

  // Optional flag
  if (step.optional) {
    line += '\n   - *(Optional — can be skipped if it fails)*';
  }

  return line;
}

/**
 * Map ActionType to a human-readable imperative verb.
 */
function actionVerb(action: string): string {
  const verbs: Record<string, string> = {
    navigate: 'Navigate to',
    click: 'Click',
    fill: 'Fill',
    type: 'Type into',
    select: 'Select option in',
    check: 'Check/toggle',
    scroll: 'Scroll',
    hover: 'Hover over',
    press: 'Press key in',
    wait: 'Wait for',
    screenshot: 'Take screenshot of',
    evaluate: 'Evaluate script on',
  };
  return verbs[action] ?? `Perform "${action}" on`;
}

/**
 * Add pre-flight warnings to output based on capability metadata.
 */
function addPreFlightWarnings(lines: string[], cap: Capability | undefined): void {
  if (!cap) return;

  const warnings: string[] = [];
  if (cap.authRequirement && cap.authRequirement !== 'none') {
    warnings.push(`⚠️ **Auth required:** ${cap.authRequirement} — ensure you have credentials before attempting`);
  }
  if (cap.executionEnginePolicy === 'blocks_headless') {
    warnings.push('⚠️ **Blocks headless browsers** — use headed/visible browser mode');
  }
  if (cap.navigationPolicy === 'requires_js_rendering') {
    warnings.push('⚠️ **Requires JavaScript rendering** — ensure JS is enabled in your browser');
  }

  if (warnings.length > 0) {
    lines.push('### Pre-flight Warnings');
    for (const w of warnings) {
      lines.push(`- ${w}`);
    }
    lines.push('');
  }
}

/**
 * Format execution tier into a human-readable label.
 */
function formatTierLabel(tier: string): string {
  switch (tier) {
    case 'api_direct': return '⚡ API Direct';
    case 'macro_verified': return '✅ Macro Verified';
    case 'selector_guided': return '🎯 Selector Guided';
    case 'url_only': return '📄 URL Only';
    case 'description_only': return '📝 Description Only';
    default: return tier;
  }
}

// ---- report_outcome ----

interface ReportStep {
  action: string;
  selector?: string;
  airProvidedSelector?: string;
  selectorMatched?: boolean;
  fallbackUsed?: string;
  value?: string;
  success: boolean;
}

async function handleReportOutcome(
  args: Record<string, unknown> | undefined,
  httpClient: AIRHttpClient
): Promise<McpToolResult> {
  const domain = args?.domain as string | undefined;
  const capability = args?.capability as string | undefined;
  // Coerce success: MCP agents may send string "true"/"false" or numeric 1/0
  const rawSuccess = args?.success;
  const success = rawSuccess === undefined ? undefined
    : typeof rawSuccess === 'boolean' ? rawSuccess
    : rawSuccess === 'true' || rawSuccess === 1;

  if (!domain) return errorResult('Missing required parameter: domain');
  if (!capability) return errorResult('Missing required parameter: capability');
  if (rawSuccess === undefined) return errorResult('Missing required parameter: success');

  const rawSteps = args?.steps;
  if (rawSteps !== undefined && !Array.isArray(rawSteps)) {
    return errorResult('Parameter "steps" must be an array of step objects');
  }
  const steps = (rawSteps ?? []) as ReportStep[];
  const notes = (args?.notes as string) ?? '';
  const requestId = (args?.requestId as string) ?? null;
  const executionTier = (args?.executionTier as string) ?? null;

  // Build enriched action sequence with selector validation data
  const actionSequence = steps.map(s => ({
    type: s.action,
    selector: s.selector,
    // Redact user-entered values to prevent PII leakage into telemetry
    value: s.value ? '[REDACTED]' : null,
    success: s.success,
    durationMs: 0,
    // Selector validation fields (new — feeds the validation loop)
    airProvidedSelector: s.airProvidedSelector ?? null,
    selectorMatched: s.selectorMatched ?? null,
    fallbackUsed: s.fallbackUsed ?? null,
  }));

  // Send telemetry report to the cloud
  try {
    await httpClient.post('/api/v1/sdk/telemetry', {
      events: [{
        domain,
        path: null,
        actionSequence,
        sessionOutcome: success ? 'success' : 'failure',
        macroId: null,
        macroVersion: null,
        macroSucceeded: null,
        recoverySequence: null,
        browserInfo: { framework: 'other', headless: false, frameworkVersion: 'unknown' },
        pageSignals: {
          ...(notes ? { agentNotes: notes } : {}),
          capability,
          requestId,
          executionTier,
          executionPath: (args?.executionPath as string) ?? null,
        },
        executionTimeMs: 0,
      }],
    });
  } catch {
    // Telemetry is best-effort — don't fail the tool call
  }

  const stepCount = steps.length;
  const successSteps = steps.filter(s => s.success).length;
  const selectorMismatches = steps.filter(s => s.airProvidedSelector && !s.selectorMatched).length;

  const lines = [
    `## Outcome reported for "${capability}" on ${domain}`,
    '',
    `**Result:** ${success ? '✅ Success' : '❌ Failed'}`,
    `**Steps reported:** ${stepCount} (${successSteps} succeeded)`,
  ];

  if (requestId) {
    lines.push(`**Request ID:** \`${requestId}\` (linked to execute_capability call)`);
  }
  if (args?.executionPath) {
    lines.push(`**Execution path:** ${args.executionPath}`);
  }

  if (selectorMismatches > 0) {
    lines.push(`**Selector corrections:** ${selectorMismatches} — AIR will learn from your working selectors`);
  }

  lines.push('');

  if (stepCount > 0) {
    const selectorsReported = steps.filter(s => s.selector && s.selector.trim() !== '').length;
    lines.push(`**Selectors captured:** ${selectorsReported} of ${stepCount} steps included CSS selectors.`);
    if (selectorsReported === 0) {
      lines.push('');
      lines.push('⚠️ **No CSS selectors were included in your report.** This report cannot be used for macro synthesis.');
      lines.push('Please call `report_outcome` again with the actual CSS selectors from your browser tool calls.');
      lines.push('Look at your click/fill/type tool calls above — each one used a CSS selector. Copy those into the steps array.');
      lines.push('');
      lines.push('Example: `{ action: "click", selector: "input#twotabsearchtextbox", success: true }`');
    } else if (selectorsReported < stepCount - 1) {
      // Allow 1 missing (navigate steps often have no selector)
      lines.push(`> ${stepCount - selectorsReported} steps are missing selectors. Include selectors for click, fill, and extract actions to maximize macro quality.`);
    }
  }

  lines.push('');
  lines.push('Your report has been recorded. ' +
    (success
      ? 'Once enough agents confirm similar steps, a verified macro will be synthesized — making this action instant for all future agents.'
      : 'Failure reports are equally valuable — they help AIR avoid recommending broken paths.'));

  if (selectorMismatches > 0) {
    lines.push('');
    lines.push('Your selector corrections are especially valuable — they help AIR keep its ' +
      'automation playbooks fresh as websites change their DOM structure.');
  }

  return textResult(lines.join('\n'));
}

// ---- Helpers ----

/**
 * Generate a short random request ID for cross-request correlation.
 * Links execute_capability → report_outcome so the system can measure
 * conversion rates and tie outcomes back to the execution tier/hints.
 */
function generateRequestId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = 'air_';
  for (let i = 0; i < 12; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function textResult(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

function errorResult(message: string): McpToolResult {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

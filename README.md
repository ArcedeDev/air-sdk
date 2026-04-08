<p align="center">
  <h1 align="center">AIR SDK</h1>
  <p align="center">
    Collective intelligence for agents. Stop your agents from guessing how to use the web. Let them know what to do. Think; hive mind. Let's make the open agent internet. 
  </p>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@arcede/air-sdk"><img src="https://img.shields.io/npm/v/@arcede/air-sdk.svg" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@arcede/air-sdk"><img src="https://img.shields.io/npm/dm/@arcede/air-sdk.svg" alt="downloads"></a>
  <a href="https://github.com/ArcedeDev/air-sdk/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="license"></a>
  <a href="https://agentinternetruntime.com/docs/sdk"><img src="https://img.shields.io/badge/docs-agentinternetruntime.com-orange.svg" alt="docs"></a>
  <img src="https://img.shields.io/badge/tests-260%20passing-brightgreen.svg" alt="tests">
  <img src="https://img.shields.io/badge/TypeScript-strict-blue.svg" alt="typescript strict">
</p>

<p align="center">
  <a href="#install">Install</a> &middot;
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#why">Why</a> &middot;
  <a href="#agent-skill">Agent Skill</a> &middot;
  <a href="https://agentinternetruntime.com/docs/sdk">Docs</a>
</p>

---

Your browser agent wastes tokens and time every time it asks an LLM what to click. AIR SDK replaces guessing with knowing. This is an early research preview.

**Up to 7,000x cost reduction and 280x faster vs frontier models. One function call. Zero code changes.**

### Benchmarks

Measured across 8 major domains, 40 cold API calls, cache disabled. LLM baseline priced at Frontier Model ($15/$75 per M tokens). AIR SDK at Scale tier ($149/mo, 250K executions).

| Scenario | LLM DOM Reasoning (Frontier Model) | AIR SDK (Macro Path) | Savings |
|----------|-------------------------------|---------------------|---------|
| **1 browser action** | ~$0.24, ~4s, ~10K tokens (2 LLM round trips to inspect DOM and act) | $0.0006, 178ms, 0 tokens | **400x cost reduction, 22x faster** |
| **10 browser actions** | Up to ~$4, ~50s, ~175K tokens (25 LLM round trips as context grows) | $0.0006, 178ms, 0 tokens | **Up to 7,000x cost reduction, 280x faster** |

The more complex the workflow, the more you save. LLM costs compound — every action adds to the conversation context, making each subsequent round trip more expensive. AIR's macro path is always one API call, regardless of how many steps the workflow has.

<details>
<summary>Methodology & raw data</summary>

**LLM baseline:** Agent inspects page DOM, reasons about which elements to interact with, generates tool calls. Frontier Model pricing ($15/M input, $75/M output).

- *1 action:* ~4,000 input + 800 output tokens x 2 round trips = ~9,600 tokens, ~$0.24, ~4s reasoning time.
- *10 actions:* Context grows with each action (conversation history accumulates). Average ~6,000 input + 1,000 output tokens x 2.5 round trips per action = 25 total LLM calls, ~175,000 tokens, ~$4.13, ~50s reasoning time.
- *Sonnet 4 comparison:* 5x cheaper per token — 1 action: ~$0.05, 10 actions: ~$0.83. Still 80–1,400x more expensive than AIR at Scale.

**AIR SDK macro path:** Pre-verified CSS selectors returned via API. Agent executes directly — no DOM inspection, no LLM reasoning. Cost = plan price / included executions. 

**Raw API latency (40 measurements, cache disabled):**
- browse_capabilities: 180ms median, 148ms min, 421ms p95
- execute_capability: 178ms median, 146ms min, 333ms p95
- Combined: 354ms median, 304ms min, 1010ms p95

**Cost per action by tier:**
| Tier | Price | Included | Effective cost |
|------|-------|----------|---------------|
| Free | $0 | 1,000/mo | $0 |
| Pro | $49/mo | 25,000/mo | $0.0020 |
| Scale | $149/mo | 250,000/mo | $0.0006 |

**Capabilities discovered:** 16 avg per domain (range: 3–39)

Last run: 2026-03-20 | [Run benchmark yourself](./benchmark/run.ts): `npx tsx benchmark/run.ts`
</details>

## Prerequisites

- Node.js >= 18
- One of: [Playwright](https://playwright.dev), [Puppeteer](https://pptr.dev), or [Browser Use](https://github.com/browser-use/browser-use) (optional peer dependencies)

## Install

```bash
npm install @arcede/air-sdk
npx @arcede/air-sdk init   # saves key to ~/.config/air/credentials.json
```

**Agent Skill (recommended for AI coding agents):**

```bash
npx @arcede/air-sdk install-skill   # auto-configures Claude Desktop, Claude Code, Cursor, Windsurf, OpenClaw
```

Free tier included. No credit card. Make the network smarter, star the repo and share it ⭐

### Lightweight Alternatives

Don't need the full SDK? We publish standalone packages for common use cases:

| Package | Install | Use case |
|---------|---------|----------|
| [`@arcede/air-mcp`](https://www.npmjs.com/package/@arcede/air-mcp) | `npx @arcede/air-mcp` | MCP server only — add AIR tools to Claude Code, Cursor, or Windsurf without the full SDK |
| [`@arcede/air-cli`](https://www.npmjs.com/package/@arcede/air-cli) | `npx @arcede/air-cli` | Terminal CLI — extract data and query capabilities from the command line |
| [`@arcede/extract`](https://www.npmjs.com/package/@arcede/extract) | `npm i @arcede/extract` | Typed TypeScript client for the Extract API only |
| [`@arcede/capabilities`](https://www.npmjs.com/package/@arcede/capabilities) | `npm i @arcede/capabilities` | Typed TypeScript client for the Capability API only |

## Quick Start

Wrap your existing Playwright page. Nothing else changes.

```typescript
import { chromium } from 'playwright';
import { withAIR } from '@arcede/air-sdk/playwright';

const browser = await chromium.launch();
const page = await browser.newPage();
const smartPage = withAIR(page, { apiKey: process.env.AIR_API_KEY });

// Your existing code — now with site intelligence
await smartPage.goto('https://example.com');
await smartPage.fill('#search', 'flights to tokyo');
await smartPage.click('.search-btn');

// Know what's possible on any site before writing automation
const capabilities = await smartPage.air.listCapabilities('example.com');
```

Also works with **Puppeteer** and **Browser Use**:

```typescript
// Puppeteer
import { withAIR } from '@arcede/air-sdk/puppeteer';
const page = withAIR(await browser.newPage(), { apiKey: process.env.AIR_API_KEY });

// Browser Use
import { AIRPlugin } from '@arcede/air-sdk/browser-use';
const agent = Agent({ plugins: [new AIRPlugin({ apiKey: process.env.AIR_API_KEY })] });
```

## Why

Browser automation is fragile. Selectors break. Sites change. Your agent has no idea what's possible until it's already on the page.

**AIR SDK gives your agent three things:**

| What | How |
|------|-----|
| **Site intelligence** | Know what actions are possible on any website — search, purchase, login, browse — before your agent navigates there. |
| **Resilient selectors** | When a selector fails, the SDK automatically resolves fallback alternatives so your automation doesn't break. |
| **Continuous learning** | The platform gets smarter over time, improving reliability and coverage across the web. |

**How it works:** Wrap your page with `withAIR()`. The SDK observes actions, resolves selectors, and preloads site capabilities. Your code doesn't change — it just works better.

**Privacy-first:** Input values, cookies, and PII are never sent. [See our privacy docs →](https://agentinternetruntime.com/docs/sdk#privacy)

## Credential Management

API keys are stored at `~/.config/air/credentials.json` with 0600 permissions (owner read/write only).

```bash
npx @arcede/air-sdk init       # Save your key (opens dashboard)
npx @arcede/air-sdk whoami     # Show current key, source, and agent status
npx @arcede/air-sdk logout     # Remove key from all locations
```

Key resolution order: `AIR_API_KEY` env var → `~/.config/air/credentials.json` → `.env` in current directory.

## Agent Skill

Give your coding agent site intelligence with one command:

```bash
npx @arcede/air-sdk install-skill
```

This auto-detects Claude Desktop, Claude Code, Cursor, Windsurf, and OpenClaw, writes the MCP server config, and injects your API key. It installs `@arcede/air-sdk` globally for fast agent startup (~2s instead of ~60s with npx) and writes the absolute binary path to each config to avoid npx version caching issues. Restart your agent and it instantly has new tools.

<details>
<summary>Manual setup (Claude Desktop, Claude Code, Cursor, Windsurf, OpenClaw)</summary>

> Requires global install: `npm install -g @arcede/air-sdk`. If not installed globally, replace `"command": "air-sdk"` with `"command": "npx"` and `"args": ["--mcp"]` with `"args": ["-y", "@arcede/air-sdk", "--mcp"]`.

**Claude Desktop** — add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "air-sdk": {
      "command": "air-sdk",
      "args": ["--mcp"],
      "env": { "AIR_API_KEY": "air_xxx" }
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add air-sdk -e AIR_API_KEY=your_key_here -- air-sdk --mcp
```

**Cursor** — add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "air-sdk": {
      "command": "air-sdk",
      "args": ["--mcp"],
      "env": { "AIR_API_KEY": "air_xxx" }
    }
  }
}
```

**Windsurf** — add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "air-sdk": {
      "command": "air-sdk",
      "args": ["--mcp"],
      "env": { "AIR_API_KEY": "air_xxx" }
    }
  }
}
```

**OpenClaw** — add to `~/.openclaw/openclaw.json`:

```json
{
  "mcpServers": {
    "air-sdk": {
      "command": "air-sdk",
      "args": ["--mcp"],
      "env": { "AIR_API_KEY": "air_xxx" }
    }
  }
}
```

</details>

**Tools available:**

| Tool | Description |
|------|-------------|
| `extract_url` | Extract structured data from any URL — JSON-LD, RSS/Atom feeds, JSON APIs, SPAs. Meta-only results cost 0 credits. |
| `browse_capabilities` | Discover what actions can be automated on a website. Returns confidence scores, tiers, selectors, and universal patterns. |
| `execute_capability` | Get a structured execution plan with CSS selectors, fallbacks, and pattern-matched guidance. |
| `report_outcome` | Report execution results with optional `browserObservations` to improve collective intelligence. |

### OpenAI Skill

AIR SDK is also available as an [OpenAI hosted shell skill](https://developers.openai.com/api/docs/guides/tools-skills) for `gpt-5.4` and `gpt-5.4-mini`:

```bash
# Package and upload
cd air-sdk/openai-skill
zip -r /tmp/air-sdk-skill.zip .
curl -X POST 'https://api.openai.com/v1/skills' \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -F 'files=@/tmp/air-sdk-skill.zip'
```

Then use in the Responses API:

```json
{
  "model": "gpt-5.4-mini",
  "tools": [{
    "type": "shell",
    "environment": {
      "type": "container_auto",
      "skills": [{ "type": "skill_reference", "skill_id": "<your_skill_id>" }],
      "network_policy": {
        "type": "allowlist",
        "allowed_domains": ["agentinternetruntime.com", "api.agentinternetruntime.com"],
        "domain_secrets": [
          { "domain": "api.agentinternetruntime.com", "name": "AIR_API_KEY", "value": "<key>" },
          { "domain": "api.agentinternetruntime.com", "name": "Authorization", "value": "Bearer <key>" }
        ]
      }
    }
  }]
}
```

Requires `api.agentinternetruntime.com` in your [org network allowlist](https://platform.openai.com/settings/organization/data-controls/hosted-tools).

## Configuration

```typescript
withAIR(page, {
  apiKey: process.env.AIR_API_KEY,  // Required
  cacheEnabled: true,                // Local capability cache (default: true)
  cacheTTLMs: 1_800_000,            // Cache TTL in ms (default: 30 min)
  debug: false,                      // Log debug info (default: false)
});
```

## Machine Payments Protocol

AIR SDK supports [x402 micropayments](https://agentinternetruntime.com/docs/sdk#mpp), enabling your agent to pay for premium site access without pre-registration:

```typescript
const smartPage = withAIR(page, {
  apiKey: process.env.AIR_API_KEY,
  mpp: {
    enabled: true,
    paymentMethod: 'stripe_spt',
    credential: 'spt_...',
    maxPerRequest: 0.50,
    maxPerSession: 5.00,
    autoApprove: true,
  },
});
```

## Examples

See [`examples/agents/`](./examples/agents/) for working agent examples:

- **Research Agent** — Multi-source research with capability-aware navigation
- **Price Comparison** — Cross-site price monitoring with resilient selectors
- **Capability Scout** — Discover and map capabilities across domains
- **Site Monitor** — Track site changes with resilient selectors

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). PRs welcome.

## Links

- [Documentation](https://agentinternetruntime.com/docs/sdk)
- [Pricing](https://agentinternetruntime.com/pricing)
- [agent.json Standard](https://agentinternetruntime.com/standards/agent-json)
- [Changelog](./CHANGELOG.md)

## License

[MIT](./LICENSE)

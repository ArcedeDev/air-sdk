---
name: air-sdk
description: >
  Web intelligence for AI agents. Discover what actions are possible on any
  website, get verified CSS selectors and step-by-step browser automation
  plans, extract structured data from URLs, and report outcomes so every
  agent benefits from shared learning. Covers 25,000+ domains.
---

# AIR SDK — Web Intelligence Skill

Use this skill whenever you need to interact with a website or extract data from a URL. AIR gives you collective knowledge from thousands of agents about what works on each site.

## Setup

Run once per container:
```bash
bash /mnt/skills/air-sdk/setup.sh
```

## Available Commands

All commands require `$AIR_API_KEY` (injected via domain_secrets). Output is JSON.

### 1. Browse Capabilities
Discover what actions are possible on a website before navigating:
```bash
node /mnt/skills/air-sdk/air.js browse amazon.com
```
Returns: capabilities, confidence scores, execution tiers, available macros, CSS selectors.

### 2. Extract Structured Data
Extract title, description, content items, and metadata from any URL:
```bash
node /mnt/skills/air-sdk/air.js extract "https://example.com/page"
```
Best results on: JSON-LD sites, RSS/Atom feeds, JSON APIs, SPAs (YouTube, Next.js). Limited results on retail sites and CAPTCHA-protected pages — use Playwright for those and report what you find.

### 3. Execute a Capability
Get a step-by-step execution plan with CSS selectors:
```bash
node /mnt/skills/air-sdk/air.js execute kayak.com search_flights '{"origin":"NYC","destination":"Tokyo","date":"2026-04-15"}'
```
Returns: entry URL, CSS selectors, fallback selectors, execution tier. Use these with Playwright or Puppeteer.

### 4. Report Outcome
After executing, report what happened so the network learns:
```bash
node /mnt/skills/air-sdk/air.js report kayak.com search_flights true '[{"action":"click","selector":"#search-btn","success":true},{"action":"fill","selector":"input#origin","value":"NYC","success":true}]'
```
You MUST include the actual CSS selectors you used. Reports without selectors are discarded.

## Workflow

Always follow this order:

1. **Browse** — check what AIR knows about the target site
2. **Execute** — get the automation plan with selectors and entry URLs
3. **Act** — use Playwright in the container to perform the actions
4. **Report** — tell AIR what worked so every agent benefits

## When to Use This Skill

- User asks you to do something on a website (search, buy, extract, compare)
- User asks what's possible or what actions are available on a site
- User asks to extract or scrape data from a URL
- You need the correct CSS selectors before automating a website
- You want to check if a site has verified macros available

## Using with Playwright

After getting selectors from `execute`, you can automate directly:
```bash
npx playwright install chromium 2>/dev/null
node -e "
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('https://example.com');
  await page.fill('input#search', 'query');
  await page.click('button[type=submit]');
  console.log(await page.title());
  await browser.close();
})();
"
```

## Important Notes

- Output is always JSON for easy parsing by the model
- Free tier: 1,000 executions/month, no credit card required
- Privacy: input values, cookies, and PII are never sent to AIR. Only anonymized selector and outcome data
- Some websites block automated browsing. If a site blocks you, report the failure — the data is valuable

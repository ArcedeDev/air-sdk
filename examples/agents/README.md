# AIR SDK Example Agents

Working examples showing how the Extract API, Capability API, and AIR SDK work together.

## Setup

```bash
cd examples/agents
npm install
```

Create a `.env` file with your API key:
```
AIR_API_KEY=your_api_key_here
```

Get keys at [agentinternetruntime.com/extract/dashboard](https://agentinternetruntime.com/extract/dashboard)

## Examples

### 1. Research Agent
Extracts and summarizes content from multiple URLs.
```bash
npx tsx research-agent.ts "https://en.wikipedia.org/wiki/Artificial_intelligence"
```

### 2. Price Comparison Agent
Browses a product site, extracts product data, compares across sources.
```bash
npx tsx price-comparison-agent.ts "wireless headphones"
```

### 3. Capability Scout
Discovers what actions are possible on any website using the Capability API.
```bash
npx tsx capability-scout.ts kayak.com amazon.com youtube.com
```

### 4. Site Monitor Agent
Monitors a site for content changes using repeated extractions.
```bash
npx tsx site-monitor-agent.ts "https://news.ycombinator.com" --interval 60
```

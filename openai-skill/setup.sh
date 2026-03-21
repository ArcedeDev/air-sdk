#!/bin/bash
# AIR SDK — OpenAI Skill Setup
# Run once per container to verify Node.js and check connectivity.

set -e

echo "[AIR SDK] Checking environment..."

# Verify Node.js >= 18 (required for built-in fetch)
NODE_VERSION=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)
if [ -z "$NODE_VERSION" ] || [ "$NODE_VERSION" -lt 18 ]; then
  echo "[AIR SDK] Error: Node.js 18+ is required (found: $(node -v 2>/dev/null || echo 'none'))"
  exit 1
fi
echo "[AIR SDK] Node.js $(node -v) OK"

# Verify API key (show prefix only — never log the full key)
if [ -z "$AIR_API_KEY" ]; then
  echo "[AIR SDK] Error: AIR_API_KEY is not set."
  echo "  Add it via domain_secrets for api.agentinternetruntime.com"
  echo "  Get a free key: https://agentinternetruntime.com/extract/dashboard/sdk"
  exit 1
fi
KEY_PREFIX=$(echo "$AIR_API_KEY" | cut -c1-12)
echo "[AIR SDK] API key configured (${KEY_PREFIX}...)"

# Test connectivity — API key passed via env var, NOT interpolated into command string
RESPONSE=$(node -e '
  const key = process.env.AIR_API_KEY;
  fetch("https://api.agentinternetruntime.com/api/v1/sdk/capabilities?domain=example.com", {
    headers: { "Authorization": "Bearer " + key },
    signal: AbortSignal.timeout(10000)
  })
  .then(r => r.json())
  .then(d => console.log(JSON.stringify({ ok: true, caps: (d.capabilities || []).length })))
  .catch(e => console.log(JSON.stringify({ ok: false, error: e.message })));
' 2>/dev/null)

if echo "$RESPONSE" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); process.exit(d.ok ? 0 : 1)' 2>/dev/null; then
  echo "[AIR SDK] API connectivity verified"
else
  echo "[AIR SDK] Warning: Could not reach API. Check network_policy allows api.agentinternetruntime.com"
fi

echo "[AIR SDK] Setup complete. Run: node /mnt/skills/air-sdk/air.js --help"

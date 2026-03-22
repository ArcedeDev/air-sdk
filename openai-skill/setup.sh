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

# Test connectivity — use curl (respects proxy) instead of Node fetch (doesn't)
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $AIR_API_KEY" \
  --max-time 10 \
  "https://api.agentinternetruntime.com/api/v1/sdk/capabilities?domain=example.com" 2>/dev/null)

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 500 ] 2>/dev/null; then
  echo "[AIR SDK] API connectivity verified (HTTP $HTTP_CODE)"
else
  echo "[AIR SDK] Warning: Could not reach API (HTTP $HTTP_CODE). Check network_policy allows api.agentinternetruntime.com"
fi

# Resolve skill directory for the model to use
SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "[AIR SDK] Skill directory: $SKILL_DIR"
echo "[AIR SDK] Setup complete. Run: node $SKILL_DIR/air.js --help"

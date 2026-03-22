# Changelog

All notable changes to this project will be documented in this file.

## [0.2.19] - 2026-03-21

### Added
- **OpenAI Skill:** AIR SDK is now available as an OpenAI hosted shell skill. Upload via `/v1/skills` API, use with `gpt-5.4` or `gpt-5.4-mini`. Requires `network_policy` allowlist for `api.agentinternetruntime.com`.
- **Content-type pre-router (S1):** `extract_url` now detects RSS, Atom, and JSON API endpoints via HEAD request and parses them directly, bypassing WebKit. Fed RSS feeds extract at 85% confidence with 20+ items. GitHub Atom feeds return full release data.
- **JSON-API nested field extraction:** `jsonObjectToContentItem()` now resolves nested fields (e.g., `commit.message`, `commit.author.date`) via dot-path traversal and one-level auto-traverse. Fixes GitHub API extraction returning only author logins.
- **Universal pattern abstraction (S2):** After macro synthesis, abstract patterns (e.g., "search_form") are extracted and stored in `sdk_universal_patterns`. Execute_capability falls back to `pattern_matched` tier (0.6 confidence) for unindexed domains.
- **Mandatory diagnostics in MCP responses (S3):** `extract_url` and `browse_capabilities` now include `[AIR-DIAG]` lines with method, confidence, items, cached status, credits, and tier distribution.
- **Browser observation capture (S4):** `report_outcome` accepts `browserObservations` (pageStructure, contentQualityVsBrowser, extractionFallbackUsed). Domains flagged as `browser_much_better` get `navigation_policy: 'requires_js_rendering'` on capability_index.
- **SDK quality-gated billing:** SDK keys no longer consume execution quota for meta-only/zero-value extractions. Previously, all SDK extract calls charged 1 execution regardless of quality.
- **Claude Desktop support in install-skill:** `install-skill` now auto-detects Claude Desktop (macOS, Windows, Linux) alongside Claude Code, Cursor, Windsurf, and OpenClaw.
- **Absolute binary path in MCP configs:** `install-skill` writes the full global binary path (e.g., `/opt/homebrew/bin/air-sdk`) instead of bare `air-sdk`, avoiding npx version caching issues.

### Fixed
- Updated MCP tool descriptions (S5): `extract_url` now mentions RSS/Atom/JSON API support and browser fallback guidance. `browse_capabilities` mentions universal patterns.
- `browserQuality` and `fallbackMethod` fields now stored in `sdk_synthesis_queue` action_pattern (previously silently dropped by report.ts).

## [0.2.12] - 2026-03-20

### Fixed
- report_outcome schema: `success` and `selectorMatched` now accept both boolean and string types (LLM agents often send `"true"` instead of `true`)
- Cross-request correlation: execute_capability generates a `requestId` that links to report_outcome for richer telemetry
- Heuristic execution hints for description_only capabilities — keeps agents in the AIR workflow even without verified macros

### Added
- Benchmarks: real API latency measurements across 8 domains, cost/speed comparison tables
- Benchmark script (`benchmark/run.ts`) for independent verification

## [0.1.1] - 2026-03-19

### Fixed
- Unified MCP server with extract_url tool
- Telemetry field mapping for cloud ingestion
- Version reporting consistency

## [0.1.0] - 2026-03-18

### Added
- Initial release
- Playwright, Puppeteer, and Browser Use adapters
- Smart selector resolution with fallback cascading
- Privacy-first telemetry with PII filtering
- Capability discovery and macro execution
- MCP server for Claude Code and Cursor
- CLI init for zero-config setup
- Machine Payments Protocol (MPP) support

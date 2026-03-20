# Changelog

All notable changes to this project will be documented in this file.

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

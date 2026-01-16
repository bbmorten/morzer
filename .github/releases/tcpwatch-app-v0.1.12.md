# tcpwatch-app-v0.1.12

## Fixes

- Fix **Analyze** in packaged builds by bundling the packet-analysis prompt into the app resources (no more missing `.github/prompts/packet-analysis.md` inside `app.asar`).
- Improve packaged configuration support:
  - Loads `ANTHROPIC_API_KEY` from `~/Library/Application Support/tcpwatch/.env`.
  - Allows `mcpcap` MCP config via `~/Library/Application Support/tcpwatch/.mcp.json`.

## Notes

- Dev/repo checkouts continue to use repo-root `.env` and `.mcp.json`.

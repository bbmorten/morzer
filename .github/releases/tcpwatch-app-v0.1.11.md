# tcpwatch-app v0.1.11

## Highlights

- Captures: right-click a split stream row and open **Analyze** to generate a report (Claude + `mcpcap`).
- Analysis report now renders as **Markdown** (tables, code blocks, etc.) in the UI.
- Analyze pipeline now mirrors the repo’s Python workflow: deterministic `mcpcap` calls + optional `tshark` stats, then a single Claude call.

## Details

- Analyze runs these `mcpcap` tools in order (when available):
  - `analyze_capinfos`
  - `analyze_dns_packets`
  - `analyze_dhcp_packets`
  - `analyze_icmp_packets`
- Adds best-effort deep inspection via `tshark` when installed:
  - TCP conversations (`-z conv,tcp`)
  - Expert notes (`-z expert,note`)
  - TCP analysis counters via `io,stat`
  - RTT sample summary from `tcp.analysis.ack_rtt`
- More robust Anthropic model selection:
  - If `TCPWATCH_CLAUDE_MODEL` is not set, the app auto-selects an available model from Anthropic `/v1/models` (prefers Opus/Sonnet 4.5).
- UI cleanup: removes remaining inline styles and improves accessibility labeling on key controls.

## Notes / Requirements

- For **Analyze**:
  - Set `ANTHROPIC_API_KEY` (repo-root `.env`, see `.env.example`).
  - Configure `mcpcap` via `.mcp.json` (or set `TCPWATCH_MCPCAP_BIN`).
- For deep packet inspection stats: install Wireshark (provides `tshark`).

## Upgrade / Compatibility

- No breaking config changes.
- Optional: pin the model explicitly via `TCPWATCH_CLAUDE_MODEL=...` if you don’t want auto-selection.

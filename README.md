# tcpwatch (Electron)

Looking for end-user instructions? See: `USER_GUIDE.md`.

This is the macOS Electron UI for the `tcpwatch` Go CLI.

## Quick Start

### 1) Install

- If you have a `.pkg` installer: run it.
- If you have a `.zip`: unzip and drag `tcpwatch.app` into `/Applications`.

If macOS blocks the app (unsigned builds), use Finder → right‑click `tcpwatch` → **Open**.

### 2) Use

- Click **Run once** to take a single snapshot.
- Click **Start** to stream updates; change filters while running to apply instantly.
- Double‑click a row to terminate that row’s PID (after confirmation).
- Use **Capture (tshark)** to record traffic and split by connection; if **Port** is set, the capture is limited to `tcp port <port>`.
- Snaplen: stream files are truncated to **200 bytes/packet** by default when splitting; set **0** to disable truncation.
- In **Captures**, each stream includes a human-friendly description (endpoints + best-effort reverse DNS).
- In **Captures**, each stream shows packet count and file size.
- In **Captures**, use **Search (Description)** to find streams by IP or FQDN.
- In **Captures**, right-click a stream row and choose **Expert Information** to see Wireshark-style per-packet expert messages for that connection (severity + group keyword aliases) plus a summary (`tshark -z expert`).
- In **Captures**, right-click a stream row and choose **Analyze** to run the packet-analysis workflow (Claude + `mcpcap` MCP tools) and show a Markdown report on a dedicated page.
- In **DNS**, select a `.pcap/.pcapng` to extract DNS packets into a new folder (one `dns.pcapng`), then click to open in Wireshark or right-click **Analyze** (uses `.github/prompts/dns-analysis.md`).
- You can also import any `.pcap`/`.pcapng` file from **Captures** (auto-split + generate `index.json`).
- You can drag & drop a `.pcap`/`.pcapng` onto the Captures page to import.

Reverse lookups are best-effort (DNS/mDNS dependent). You can disable them with `TCPWATCH_RDNS=0`.

For details (filters, troubleshooting, permissions), see `USER_GUIDE.md`.

## Prereqs

- Node.js + npm
- A built `tcpwatch` binary at `tools/tcpwatch/tcpwatch`
- Wireshark installed (provides `tshark` and `editcap`) for capture/splitting, snaplen truncation, and Expert Information analysis
- For **Analyze**: an Anthropic API key (`ANTHROPIC_API_KEY`) and `mcpcap` available via `.mcp.json` (or `TCPWATCH_MCPCAP_BIN` override). See `.env.example`.

Packaged app notes (Analyze):

- The prompt is bundled into the app at `Contents/Resources/prompts/packet-analysis.md`.
- You can configure:
	- `ANTHROPIC_API_KEY` via `~/Library/Application Support/tcpwatch/.env`
	- `mcpcap` via `~/Library/Application Support/tcpwatch/.mcp.json` (or `TCPWATCH_MCPCAP_BIN`)

Build the binary:

```bash
cd tools/tcpwatch
go build -o tcpwatch
```

## Dev

```bash
cd tools/tcpwatch/app
npm install
npm run dev
```

## Packaging (unsigned)

```bash
cd tools/tcpwatch/app
npm run pack:dir
```

## Downloadable builds (GitHub Actions)

This repo includes a workflow that builds and uploads macOS artifacts (`.pkg` + `.zip`) so they can be downloaded from GitHub.

- Manual: run the `tcpwatch (macOS)` workflow via **Actions** → select a run → download the artifacts.
- Release assets: push a tag like `tcpwatch-app-v0.1.1` and the workflow will attach the artifacts to the GitHub Release for that tag.

Tag example:

```bash
git tag tcpwatch-app-vX.Y.Z
git push origin tcpwatch-app-vX.Y.Z
```

Maintainers: see `.github/specs/tcpwatch-release.md` for the release/packaging checklist.

The app expects the `tcpwatch` binary to be bundled via `extraResources`.

## Notes

- You can override the binary path with `TCPWATCH_BIN=/abs/path/to/tcpwatch`.
- The UI consumes `tcpwatch -jsonl` (NDJSON snapshots).

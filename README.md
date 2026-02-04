# tcpwatch (Electron)

Looking for end-user instructions? See: `USER_GUIDE.md`.

A cross-platform Electron UI for the `tcpwatch` Go CLI. Supports macOS and Windows.

## Quick Start

### 1) Install

**macOS**:
- If you have a `.pkg` installer: run it.
- If you have a `.zip`: unzip and drag `tcpwatch.app` into `/Applications`.
- If macOS blocks the app (unsigned builds), use Finder → right‑click `tcpwatch` → **Open**.

**Windows**:
- Install prerequisites: [Go](https://go.dev/dl/), [Node.js](https://nodejs.org/), and [Wireshark](https://www.wireshark.org/download.html).
- Clone the repo and run from source (see Dev section below).

### 2) Use

- Click **Run once** to take a single snapshot.
- Click **Start** to stream updates; change filters while running to apply instantly.
- Double‑click a row to terminate that row’s PID (after confirmation).
- Use **Capture (tshark)** to record traffic and split by connection; if **Port** is set, the capture is limited to `tcp port <port>`.
- Snaplen: stream files are truncated to **65535 bytes/packet** by default when splitting; set **0** to disable truncation.
- In **Captures**, each stream includes a human-friendly description (endpoints + best-effort reverse DNS).
- In **Captures**, each stream shows packet count and file size.
- In **Captures**, use **Search (Description)** to find streams by IP or FQDN.
- In **Captures**, right-click a stream row and choose **Expert Information** to see Wireshark-style per-packet expert messages for that connection (severity + group keyword aliases) plus a summary (`tshark -z expert`).
- In **Captures**, right-click a stream row and choose **Analyze** to run the packet-analysis workflow (Claude + `mcpcap` MCP tools) and show a Markdown report on a dedicated page.
- In **DNS**, select a `.pcap/.pcapng` to extract DNS packets into a new folder (one `dns.pcapng`), then click to open in Wireshark or right-click **Analyze** (uses `.github/prompts/dns-analysis.md`).
- You can also import any `.pcap`/`.pcapng` file from **Captures** (auto-split + generate `index.json`).
- You can drag & drop a `.pcap`/`.pcapng` onto the Captures page to import.

Reverse lookups are best-effort (DNS/mDNS dependent). You can disable them in **Settings** or with `TCPWATCH_RDNS=0`.

For details (filters, troubleshooting, permissions), see `USER_GUIDE.md`.

## Prereqs

- **Go** (1.21+)
- **Node.js** + npm
- **Wireshark** installed (provides `tshark` and `editcap`) for capture/splitting, snaplen truncation, and Expert Information analysis
- For **Analyze**: an Anthropic API key and `mcpcap` (`pip install mcpcap`)

### mcpcap Setup

`mcpcap` is the MCP server that provides packet analysis tools to Claude. Install it via pip:

```bash
pip install mcpcap
```

Then configure the path to the `mcpcap` binary in the app's **Settings** page (recommended) or via the `TCPWATCH_MCPCAP_BIN` environment variable. The Settings page stores the path per-machine in `config.json`, keeping it separate from the repository.

Typical binary locations after `pip install mcpcap`:
- **macOS**: `~/.local/bin/mcpcap` or inside a virtualenv
- **Windows**: `C:\Users\<user>\AppData\Local\...\Python3XX\Scripts\mcpcap.exe`

The `.mcp.json` at the repo root is a macOS-only fallback. On Windows, always use the Settings page.

### Packaged app notes (Analyze)

- The prompt is bundled into the app at `Contents/Resources/prompts/packet-analysis.md`.
- Configure the API key and binary paths via **Settings** (Cmd+, on macOS, app menu on Windows).
- Settings are stored in:
  - **macOS**: `~/Library/Application Support/tcpwatch/config.json`
  - **Windows**: `%APPDATA%/tcpwatch/config.json`
- Existing `.env` files are automatically migrated to `config.json` on first launch.

### Build the Go binary

**macOS**:
```bash
cd tools/tcpwatch
go build -o tcpwatch
```

**Windows**:
```bash
cd tools\tcpwatch
go build -o tcpwatch.exe
```

Or use the npm script which handles this automatically:
```bash
cd tools/tcpwatch/app
npm run build:tcpwatch
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

## Configuration

All binary paths and settings can be configured via the in-app **Settings** page. See `CLAUDE.md` for the full configuration parameter reference.

| Setting | Env Variable | Description |
|---------|-------------|-------------|
| Anthropic API Key | `ANTHROPIC_API_KEY` | Required for AI analysis |
| Claude Model | `TCPWATCH_CLAUDE_MODEL` | Model override |
| mcpcap | `TCPWATCH_MCPCAP_BIN` | Path to mcpcap binary |
| tshark | `TSHARK_BIN` | Path to tshark |
| editcap | `EDITCAP_BIN` | Path to editcap |
| Wireshark | `WIRESHARK_BIN` | Path to Wireshark |
| tcpwatch | `TCPWATCH_BIN` | Path to tcpwatch binary |
| Reverse DNS | `TCPWATCH_RDNS` | Enable/disable reverse DNS |

## Notes

- You can override the binary path with `TCPWATCH_BIN=/abs/path/to/tcpwatch` (or set it in Settings).
- The UI consumes `tcpwatch -jsonl` (NDJSON snapshots).
- On Windows, process information is gathered via PowerShell `Get-Process` instead of `witr`.

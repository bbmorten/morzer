# tcpwatch — User Guide

`tcpwatch` is a cross-platform desktop app (macOS and Windows) that shows live TCP connections on your machine and (optionally) lets you terminate the owning process.

## Install

### macOS

You can install via either:

- **PKG installer** (`tcpwatch-…​.pkg`): run it and follow the prompts.
- **ZIP** (`tcpwatch-…​.zip`): unzip, then drag `tcpwatch.app` into `/Applications`.

### Windows

Run from source:

1. Install [Go](https://go.dev/dl/), [Node.js](https://nodejs.org/), and [Wireshark](https://www.wireshark.org/download.html).
2. Clone the repository.
3. Run:
   ```bash
   cd tools\tcpwatch\app
   npm install
   npm run dev
   ```

## Downloads / Releases

If you received the app from GitHub:

- **Releases page**: download the `.pkg` or `.zip` attached to a tagged release (tags look like `tcpwatch-app-vX.Y.Z`).
- **Actions artifacts**: maintainers can also download build artifacts from the `tcpwatch (macOS)` workflow run.

### First run / Gatekeeper (macOS only)

Because the app may be **unsigned** (developer builds), macOS may block it the first time.

- Finder → Applications → right‑click `tcpwatch` → **Open** → confirm.
- Or: System Settings → Privacy & Security → allow the blocked app.

#### Removing the quarantine attribute

If macOS shows "tcpwatch cannot be verified" or similar warnings, you can remove the quarantine attribute that macOS adds to downloaded files:

```bash
# For the PKG installer (before installing)
sudo xattr -rd com.apple.quarantine /path/to/tcpwatch-0.1.1-arm64.pkg

# For the installed binary (if already installed)
sudo xattr -rd com.apple.quarantine /usr/local/bin/tcpwatch

# For the app bundle
sudo xattr -rd com.apple.quarantine /Applications/tcpwatch.app
```

After running the appropriate command, you can install or run the app normally.

## What you see

Each row is a single TCP socket/connection.

Columns:

- **PROTO**: `tcp`, `tcp4`, `tcp6`
- **LOCAL**: local address + port
- **REMOTE**: remote address + port
- **STATE**: TCP state (e.g. `ESTABLISHED`, `LISTEN`, `CLOSE_WAIT`)
- **PID**: owning process ID
- **PROCESS**: process name (best effort; may be blank depending on permissions)

## Controls

### Start / Stop (streaming)

- **Start** begins streaming updates at the configured interval.
- **Stop** stops streaming.

While streaming, edits to filters (PID/Port/State/Process/Include LISTEN) automatically apply.

### Run once (snapshot)

- **Run once** fetches a single snapshot and updates the table.

## Packet capture (tshark)

The app can start a short packet capture using `tshark` (from Wireshark) and then split the capture into per-connection files.

### Prerequisites

- Install **Wireshark** (it includes the `tshark` CLI).
- Capturing packets may require elevated privileges or capture permissions on macOS.

### How to capture

1. Click **Start** (so tcpwatch is streaming).
2. In the **Capture (tshark)** section:
   - Choose a **Dump folder**
   - Pick an **Interface**
   - Set **Max duration** (1–300 seconds)
  - Set **Snaplen (bytes)** (default **65535**; set **0** to disable truncation)
  - Optional: set the **Port** filter (under Filters) to scope capture to a single port.
3. Click **Start capture**.
4. Click **Stop capture** to stop early (otherwise it stops automatically at the max duration).

If **Port** is set, the app starts `tshark` with a capture filter `tcp port <port>`, so only matching traffic is written to the `.pcapng`.

### What happens after capture

- The app writes one capture file: `tcpwatch-capture-<timestamp>.pcapng`.
- After capture stops, it automatically **splits** by `tcp.stream` into a folder like:
  - `tcpwatch-split-<timestamp>/tcp-stream-00000.pcapng`, etc.
- It also writes `tcpwatch-split-<timestamp>/index.json` listing all generated stream files.

The `index.json` also includes **best-effort metadata** per stream (source/destination IP:port) and, when possible, **reverse-DNS hostnames** for IPs.

Notes:

- Reverse lookups are inherently best-effort: many IPs have no PTR record, and local devices may only resolve via mDNS/Bonjour.
- If you want to disable reverse lookups (faster splitting), toggle it off in **Settings** or run the app with `TCPWATCH_RDNS=0`.
- Tuning knobs (optional):
  - `TCPWATCH_RDNS_TIMEOUT_MS` (default `2000`)
  - `TCPWATCH_RDNS_CONCURRENCY` (default `8`)

### Viewing split files

- Open the **Captures** page in the app.
- Select a split folder (or it will auto-select the most recent split from the last capture).
- Or: click **Capture file…** and choose any `.pcap`/`.pcapng` file. If it doesn’t have a split `index.json`, the app will automatically split it and generate one (using the current **Snaplen (bytes)** setting).
- You can also **drag & drop** a `.pcap`/`.pcapng` onto the Captures page to import it.
- Use the **Search (Description)** box to find streams by IP address or hostname.
- Double-click a stream row to open the `.pcapng` in **Wireshark**.
- Right-click a stream row to open the analysis menu, then choose **Expert Information** to view Wireshark-style per-packet expert messages for that connection.
- Right-click a stream row and choose **Analyze** to run an AI-assisted capture analysis (Claude + `mcpcap` MCP tools) and open the report on a dedicated page.

## DNS

The **DNS** page extracts DNS packets from a `.pcap/.pcapng` into a new folder and produces a DNS-only `dns.pcapng`.

How to use:

1. Open **DNS**.
2. Select a capture file (or drag & drop one onto the page).
3. Click **Extract DNS**.
4. Click `dns.pcapng` to open it in Wireshark.
5. Right-click `dns.pcapng` and choose **Analyze** to run the DNS prompt (`.github/prompts/dns-analysis.md`) and open the report.

Notes:

- DNS extraction uses `tshark -Y (dns || mdns || llmnr)` and may produce an empty file if the capture contains no dissectable DNS/mDNS/LLMNR.
- DNS analysis uses the same prerequisites as other analysis features (Anthropic API key + mcpcap).

The Captures table shows a **Description** column (derived from the stream endpoints and reverse-DNS hostnames when available), plus **Packets** and **Size**.

### Expert Information

The **Expert Information** view is modeled after Wireshark’s *Analyze → Expert Information* feature.

What you get:

- A per-packet table of expert messages (one row per expert item), including:
  - **Severity**: keyword aliases like `chat`, `note`, `warn`, `error`
  - **Group**: keyword aliases like `sequence`, `protocol`, `checksum`, `reassemble`, `malformed`, etc.
- A collapsible **Summary** section which is the raw output of `tshark -z expert`.

Notes:

- Expert Information is a starting point, not proof of a problem.
- Some streams have no expert items; the table may be empty.
- This analysis invokes `tshark` and may take a moment on large stream files.

### Analyze (Claude + mcpcap)

The **Analyze** view runs a packaged packet-analysis prompt and uses the `mcpcap` MCP server to extract structured information from the capture.

The report is rendered as Markdown (tables, code blocks, etc.).

Prerequisites:

- An Anthropic API key.
- The `mcpcap` MCP server binary, installed and configured (see [mcpcap Configuration](#mcpcap-configuration) below).

Configuration:

- Open **Settings** (Cmd+, on macOS, or app menu → Settings...) and enter your Anthropic API key. Settings are stored in `config.json` and persist across restarts.
- Set the **mcpcap** binary path in the Settings page (recommended). See [mcpcap Configuration](#mcpcap-configuration) for details.
- Existing `.env` files are automatically migrated to `config.json` on first launch.

Notes:

- The analysis runs locally in the Electron main process and may take a while on large files.
- If the API key is missing, you'll see an error directing you to Settings.

### mcpcap Configuration

`mcpcap` is the MCP (Model Context Protocol) server that provides packet analysis tools to Claude. It reads `.pcap`/`.pcapng` files and exposes structured data (DNS records, DHCP leases, ICMP messages, capture info) as MCP tools.

**Install**:

```bash
pip install mcpcap
```

**Configure**: Open the app's **Settings** page and set the **mcpcap** field to the absolute path of the `mcpcap` binary. This is the recommended approach because it stores the path per-machine in `config.json` and does not affect the repository.

**Finding the binary path after installation**:

| Platform | Command | Typical Path |
|----------|---------|--------------|
| macOS | `which mcpcap` | `/path/to/venv/bin/mcpcap` or `~/.local/bin/mcpcap` |
| Windows | `where mcpcap` or check pip output | `C:\Users\<user>\AppData\Local\...\Python3XX\Scripts\mcpcap.exe` |

If `where mcpcap` (Windows) or `which mcpcap` (macOS) returns nothing, look for the "Scripts" directory in the pip installation warnings, e.g.:

```
WARNING: The script mcpcap.exe is installed in '...\Scripts' which is not on PATH.
```

Copy the full path and paste it into the Settings **mcpcap** field.

**Alternative configuration methods** (in order of precedence):

1. `TCPWATCH_MCPCAP_BIN` environment variable
2. Settings page **mcpcap** field (stored in `config.json`)
3. `.mcp.json` at the repo root (macOS fallback only)

The `.mcp.json` file at the repo root contains a macOS-specific default path and should not be modified for Windows development.

## Settings

Open Settings via **Cmd+,** (macOS) or the app menu (**tcpwatch → Settings...**).

### Settings Reference

| Setting | Env Variable | Description | Default |
|---------|-------------|-------------|---------|
| **Anthropic API Key** | `ANTHROPIC_API_KEY` | Required for Claude-powered analysis features (Analyze, DNS Analyze) | (none) |
| **Claude Model** | `TCPWATCH_CLAUDE_MODEL` | Override the model used for analysis. Leave empty to use the default | `claude-sonnet-4-20250514` |
| **mcpcap** | `TCPWATCH_MCPCAP_BIN` | Absolute path to the `mcpcap` MCP server binary. Install with `pip install mcpcap`. See [mcpcap Configuration](#mcpcap-configuration) | Auto-detect |
| **tshark** | `TSHARK_BIN` | Path to tshark binary (from Wireshark). Used for packet capture, stream splitting, Expert Information, and DNS extraction | Auto-detect |
| **editcap** | `EDITCAP_BIN` | Path to editcap binary (from Wireshark). Used for stream splitting with snaplen truncation | Auto-detect |
| **Wireshark** | `WIRESHARK_BIN` | Path to the Wireshark GUI binary. Used for opening capture files | Auto-detect |
| **tcpwatch** | `TCPWATCH_BIN` | Path to the Go tcpwatch binary. Used for TCP connection monitoring | Auto-detect |
| **Reverse DNS** | `TCPWATCH_RDNS` | Enable or disable reverse DNS lookups during stream splitting. Set to `0` or `false` to disable | Enabled |

### Auto-detection Paths

When a binary path is left empty (recommended), the app searches standard installation locations:

**tshark / editcap / Wireshark / dumpcap**:
- macOS: `/Applications/Wireshark.app/Contents/MacOS/`, `/usr/local/bin/`, `/opt/homebrew/bin/`
- Windows: `C:\Program Files\Wireshark\`, `C:\Program Files (x86)\Wireshark\`

**tcpwatch**:
- Dev mode: walks up from the app directory looking for `tools/tcpwatch/tcpwatch` (or `tcpwatch.exe` on Windows)
- Packaged: bundled in the app resources

### Storage Locations

Settings are stored in `config.json`:

- **macOS packaged**: `~/Library/Application Support/tcpwatch/config.json`
- **Windows packaged**: `%APPDATA%/tcpwatch/config.json`
- **Dev mode** (any platform): `config.json` in the repo root (gitignored)

### Precedence

Configuration values are resolved in this order (highest to lowest):

1. Shell environment variables
2. `config.json` values (set via Settings page)
3. `.env` file values (legacy, auto-migrated to `config.json` on first launch)
4. `.mcp.json` at repo root (mcpcap only, macOS fallback)

## Filters

All filters are optional.

- **Interval (ms)**: refresh period. Lower = more CPU.
- **State CSV**: comma-separated states, e.g. `ESTABLISHED,CLOSE_WAIT`.
- **PID**: show only rows with that owning PID.
- **Port**: matches **local OR remote** port.
- **Process**: case-insensitive substring match against the process name.
- **Include LISTEN**: if unchecked, LISTEN sockets are excluded.

## Terminating a process (double-click)

To terminate the owning process for a row:

1. **Double-click** the row.
2. Confirm the prompt.

What happens:

- The app sends **SIGTERM** to that PID.
- If you don’t have permission, you’ll see an error like **“Permission denied”**.
- The app refuses to terminate protected PIDs (the app itself and its helper process).

Safety notes:

- Some processes may ignore SIGTERM.
- Terminating system processes can cause instability.
- If you need “force kill” behavior (SIGKILL), request it explicitly; it is not enabled by default.

## Permissions & missing process names

The OS may restrict visibility into other processes.

**macOS**: If you see missing `PROCESS` names or can't terminate a PID:

- Try running the CLI directly from Terminal as admin (for debugging):

  ```bash
  cd tools/tcpwatch
  sudo ./tcpwatch
  ```

- For the desktop app, you typically need to run it normally; it will show what macOS allows.

**Windows**: Run the app as Administrator to see process names for system services. Some processes may show an empty name due to access restrictions.

## Process Information

When you click on a process row, the app shows detailed process information:

- **macOS**: Uses `witr -p <pid>` (install with `go install github.com/morzer/witr@latest`). If `witr` is not installed, you'll see an informational message.
- **Windows**: Uses PowerShell `Get-Process` and `netstat`. Shows process name, path, start time, CPU usage, memory, threads, handles, window title, and active network connections.

## Troubleshooting

### App window is blank

**macOS**: Run the app from Terminal to capture logs:

```bash
OPEN_DEVTOOLS=1 ELECTRON_ENABLE_LOGGING=1 /Applications/tcpwatch.app/Contents/MacOS/tcpwatch
```

**Windows**: Run from a terminal with `npm run dev` to see console output.

This opens DevTools and prints main/renderer load diagnostics to the terminal.

### No data / empty table

- Try **Run once**.
- Remove all filters (PID/Port/State/Process) and try again.
- Ensure **Include LISTEN** is enabled if you expect LISTEN sockets.

### mcpcap / Analyze errors

- Verify `mcpcap` is installed: `mcpcap --help`
- Check the Settings page has the correct **mcpcap** path
- Verify the **Anthropic API Key** is set in Settings
- Check the Electron console for detailed error messages

### tshark not found

- Ensure Wireshark is installed
- On Windows, check `C:\Program Files\Wireshark\tshark.exe` exists
- On macOS, check `/Applications/Wireshark.app` exists
- Or set the path manually in Settings

## Uninstall

**macOS**:
- If installed via ZIP: delete `/Applications/tcpwatch.app`.
- If installed via PKG: you can still remove `/Applications/tcpwatch.app` (the installer does not create required system services).

**Windows**: Delete the cloned repository folder. No system-level files are installed.

## Privacy

The app reads local network socket metadata and process names (when available). It does not send that data anywhere by default. When using the Analyze feature, capture data is sent to the Anthropic API for analysis.

# Morzer - Network Analysis Tools

A cross-platform network analysis toolkit featuring TCP connection monitoring and packet capture analysis. Supports macOS and Windows.

## Project Structure

```
morzer/
├── tools/tcpwatch/           # Main application
│   ├── main.go               # Go backend (gopsutil-based TCP monitoring)
│   ├── go.mod, go.sum        # Go dependencies
│   └── app/                  # Electron desktop application
│       ├── src/renderer/     # React UI components
│       ├── electron/         # Main process, IPC handlers, preload
│       └── package.json      # npm config, electron-builder settings
├── .github/
│   ├── releases/             # Release notes (tcpwatch-app-vX.Y.Z.md)
│   ├── prompts/              # AI analysis prompts (packet-analysis.md, dns-analysis.md)
│   ├── workflows/            # CI/CD (ci.yml, tcpwatch-macos.yml, tcpwatch-windows.yml)
│   └── skills/               # Project skills documentation
├── .claude/commands/         # Claude Code skills
├── captures/                 # Sample PCAP files
└── test/                     # Python test scripts
```

## tcpwatch-app

Cross-platform Electron application for TCP connection monitoring with features:
- Live TCP connection monitoring via gopsutil (sysctl on macOS, Windows APIs on Windows)
- Packet capture with tshark integration
- Stream splitting with reverse DNS lookups
- DNS/mDNS/LLMNR extraction and analysis
- Process info via `witr -p <pid>` (macOS) or PowerShell `Get-Process` (Windows)
- Claude AI-powered packet analysis via MCP
- In-app Settings page with JSON config persistence

### Installation

**macOS**: After downloading the `.app` bundle, clear the quarantine attribute before running:

```bash
xattr -cr /path/to/tcpwatch.app
```

**Windows**: No special installation steps required. Ensure Go, Node.js, and Wireshark are installed.

### Development Commands

```bash
cd tools/tcpwatch/app
npm install
npm run dev           # Start dev server with hot reload
npm run typecheck     # TypeScript validation (renderer + electron)
npm run build         # Full build (Go + React + Electron)
npm run pack          # Package for distribution (zip + pkg)
```

### Platform Notes

The build scripts are cross-platform. On Windows, the Go binary is built as `tcpwatch.exe` and all external tool paths (tshark, editcap, Wireshark, dumpcap) resolve to standard Windows installation directories (e.g. `C:\Program Files\Wireshark\`).

### Key Files

| File | Purpose |
|------|---------|
| `package.json` | Version, dependencies, electron-builder config |
| `electron/main.ts` | Electron main process, all IPC handlers |
| `electron/config.ts` | JSON config read/write/migrate, env precedence |
| `electron/preload.cjs` | IPC bridge (CommonJS for compatibility) |
| `src/renderer/vite-env.d.ts` | TypeScript types for window.tcpwatch API |
| `src/renderer/types.ts` | Shared type definitions |

### IPC Bridge Convention

The preload bridge (`preload.cjs`) and TypeScript types (`vite-env.d.ts`) must be kept in sync. When adding new IPC methods:
1. Add handler in `electron/main.ts`
2. Add bridge method in `electron/preload.cjs`
3. Add type in `src/renderer/vite-env.d.ts`

## External Dependencies

- **tshark/editcap** - Wireshark CLI tools for packet capture (auto-detected on macOS and Windows)
- **witr** - Process information tool, macOS only (`go install github.com/morzer/witr@latest`). On Windows, PowerShell `Get-Process` is used instead.
- **mcpcap** - MCP server for AI-powered packet analysis (`pip install mcpcap`). Configured via the Settings page (`mcpcapBin` field) or `TCPWATCH_MCPCAP_BIN` env var. The `.mcp.json` at repo root is the macOS default fallback only.

## Skills

### /release

Create a new release for tcpwatch-app:
1. Check for uncommitted changes
2. Bump version in `tools/tcpwatch/app/package.json`
3. Create release notes in `.github/releases/tcpwatch-app-v{VERSION}.md`
4. Commit with message: `Release tcpwatch-app v{VERSION}`
5. Push to remote
6. Create GitHub release: `gh release create tcpwatch-app-v{VERSION} -F .github/releases/tcpwatch-app-v{VERSION}.md`

## CI/CD

- **ci.yml** - Go format, vet, build, test on push/PR
- **tcpwatch-macos.yml** - Build and publish macOS app (arm64) on `tcpwatch-app-v*` tags
- **tcpwatch-windows.yml** - Build and publish Windows app (x64, NSIS + zip) on `tcpwatch-app-v*` tags

## Configuration

Settings are managed via the in-app **Settings** page (Cmd+, on macOS; app menu on Windows) and stored in `config.json`:
- **macOS packaged**: `~/Library/Application Support/tcpwatch/config.json`
- **Windows packaged**: `%APPDATA%/tcpwatch/config.json`
- **Dev mode**: `config.json` in the repo root (gitignored)

Precedence (highest → lowest):
1. Shell environment variables
2. `config.json` values
3. `.env` file values (legacy, auto-migrated on first launch)
4. `.mcp.json` (mcpcap only, macOS fallback)

### Config Parameters

All parameters can be set via the Settings page UI or as environment variables.

| Settings Field | Environment Variable | Description |
|---------------|---------------------|-------------|
| Anthropic API Key | `ANTHROPIC_API_KEY` | Required for Claude-powered analysis features |
| Claude Model | `TCPWATCH_CLAUDE_MODEL` | Model for analysis (default: claude-sonnet-4-20250514) |
| mcpcap | `TCPWATCH_MCPCAP_BIN` | Absolute path to the `mcpcap` binary. Install with `pip install mcpcap`. Platform-specific: on macOS typically in a virtualenv, on Windows in the Python Scripts directory |
| tshark | `TSHARK_BIN` | Path to tshark. Auto-detected from Wireshark installation |
| editcap | `EDITCAP_BIN` | Path to editcap. Auto-detected from Wireshark installation |
| Wireshark | `WIRESHARK_BIN` | Path to Wireshark GUI binary |
| tcpwatch | `TCPWATCH_BIN` | Path to the Go tcpwatch binary |
| Reverse DNS | `TCPWATCH_RDNS` | Enable reverse DNS lookups during stream splitting (true/false) |

### mcpcap Configuration

`mcpcap` is the MCP (Model Context Protocol) server that provides packet analysis tools to Claude. It is required for the AI-powered **Analyze** feature.

**Install**: `pip install mcpcap`

**Configure**: Set the absolute path to the `mcpcap` binary in the Settings page under the **mcpcap** field. This is the recommended approach as it is stored per-machine in `config.json` and does not affect the repository.

Typical paths:
- **macOS** (virtualenv): `/path/to/venv/bin/mcpcap`
- **macOS** (Homebrew/pip): `~/.local/bin/mcpcap` or similar
- **Windows** (pip): `C:\Users\<user>\AppData\Local\...\Python3XX\Scripts\mcpcap.exe`

The `.mcp.json` file at the repo root serves as a macOS-only fallback and should not be modified for Windows development. Use the Settings page instead.

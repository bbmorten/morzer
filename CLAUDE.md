# Morzer - Network Analysis Tools

A network analysis toolkit featuring TCP connection monitoring and packet capture analysis for macOS.

## Project Structure

```
morzer/
├── tools/tcpwatch/           # Main application
│   ├── main.go               # Go backend (sysctl-based TCP monitoring)
│   ├── go.mod, go.sum        # Go dependencies
│   └── app/                  # Electron desktop application
│       ├── src/renderer/     # React UI components
│       ├── electron/         # Main process, IPC handlers, preload
│       └── package.json      # npm config, electron-builder settings
├── .github/
│   ├── releases/             # Release notes (tcpwatch-app-vX.Y.Z.md)
│   ├── prompts/              # AI analysis prompts (packet-analysis.md, dns-analysis.md)
│   ├── workflows/            # CI/CD (ci.yml, tcpwatch-macos.yml)
│   └── skills/               # Project skills documentation
├── .claude/commands/         # Claude Code skills
├── captures/                 # Sample PCAP files
└── test/                     # Python test scripts
```

## tcpwatch-app

macOS Electron application for TCP connection monitoring with features:
- Live TCP connection monitoring via gopsutil/sysctl
- Packet capture with tshark integration
- Stream splitting with reverse DNS lookups
- DNS/mDNS/LLMNR extraction and analysis
- Process info via `witr -p <pid>` integration
- Claude AI-powered packet analysis via MCP

### Installation

After downloading the `.app` bundle, clear the quarantine attribute before running:

```bash
xattr -cr /path/to/tcpwatch.app
```

### Development Commands

```bash
cd tools/tcpwatch/app
npm install
npm run dev           # Start dev server with hot reload
npm run typecheck     # TypeScript validation (renderer + electron)
npm run build         # Full build (Go + React + Electron)
npm run pack          # Package for distribution (zip + pkg)
```

### Key Files

| File | Purpose |
|------|---------|
| `package.json` | Version, dependencies, electron-builder config |
| `electron/main.ts` | Electron main process, all IPC handlers |
| `electron/preload.cjs` | IPC bridge (CommonJS for compatibility) |
| `src/renderer/vite-env.d.ts` | TypeScript types for window.tcpwatch API |
| `src/renderer/types.ts` | Shared type definitions |

### IPC Bridge Convention

The preload bridge (`preload.cjs`) and TypeScript types (`vite-env.d.ts`) must be kept in sync. When adding new IPC methods:
1. Add handler in `electron/main.ts`
2. Add bridge method in `electron/preload.cjs`
3. Add type in `src/renderer/vite-env.d.ts`

## External Dependencies

- **tshark/editcap** - Wireshark CLI tools for packet capture
- **witr** - Process information tool (`go install github.com/morzer/witr@latest`)
- **mcpcap** - MCP server for packet analysis (configured in `.mcp.json`)

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
- **tcpwatch-macos.yml** - Build and publish macOS app on `tcpwatch-app-v*` tags

## Configuration

Environment variables (set in `~/Library/Application Support/tcpwatch/.env`):
- `ANTHROPIC_API_KEY` - Required for Claude analysis
- `TCPWATCH_CLAUDE_MODEL` - Model for analysis (default: claude-sonnet-4-20250514)
- `TCPWATCH_MCPCAP_BIN` - Path to mcpcap binary
- `TCPWATCH_RDNS` - Enable reverse DNS (true/false)

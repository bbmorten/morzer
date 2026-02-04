# tcpwatch-app-v0.3.2

## Features

- Windows cross-platform support: the app now runs on Windows in addition to macOS
- Windows binary path auto-detection for tshark, editcap, Wireshark, dumpcap, and tcpwatch from standard installation directories (`C:\Program Files\Wireshark\`, etc.)
- PowerShell-based process information on Windows (replaces macOS-only `witr`), showing process name, path, CPU, memory, threads, handles, and network connections
- Cross-platform `build:tcpwatch` npm script that produces `tcpwatch.exe` on Windows

## Bug Fixes

- Fix `AF_INET6` constant in Go backend: use `syscall.AF_INET6` instead of hardcoded macOS value (30), fixing IPv6 connection display on Windows (where AF_INET6 = 23)
- Fix `psComm` fallback: skip Unix `ps` command on Windows to avoid spawn errors
- Fix `dumpcap` path resolution for capture filter validation on Windows
- Fix Wireshark launch: use non-blocking `spawn` with `detached: true` instead of blocking `spawnSync` for the `exec` path
- Use `where` instead of `which` for binary lookup on Windows

## Documentation

- Updated CLAUDE.md, README.md, and USER_GUIDE.md with cross-platform instructions
- Added detailed configuration parameter reference with all Settings fields, environment variables, and defaults
- Added mcpcap configuration guide with platform-specific installation and path-finding instructions
- Added troubleshooting sections for Windows-specific issues (tshark not found, mcpcap errors)

## Notes

- The `.mcp.json` at the repo root is a macOS-only fallback. On Windows, configure mcpcap via the Settings page.
- Install mcpcap with `pip install mcpcap` and set the binary path in Settings.

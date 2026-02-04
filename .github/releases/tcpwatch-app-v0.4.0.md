# tcpwatch-app-v0.4.0

## Highlights

This release adds full **Windows support** to tcpwatch-app, making it a cross-platform network analysis tool for both macOS and Windows.

## Features

- **Windows platform support**: tcpwatch-app now runs natively on Windows alongside macOS
- **Cross-platform binary resolution**: auto-detection of tshark, editcap, Wireshark, dumpcap, and tcpwatch binaries from standard Windows installation directories (`C:\Program Files\Wireshark\`, etc.)
- **PowerShell-based process information** on Windows: shows process name, path, start time, CPU, memory, threads, handles, window title, and active network connections (replaces macOS-only `witr`)
- **Cross-platform Go build**: `npm run build:tcpwatch` now correctly produces `tcpwatch.exe` on Windows
- **Non-blocking Wireshark launch** on Windows using detached spawn

## Bug Fixes

- Fix `AF_INET6` constant: use `syscall.AF_INET6` instead of hardcoded macOS value (30 on macOS vs 23 on Windows), fixing IPv6 connection display on Windows
- Fix `psComm` fallback: skip Unix `ps` command on Windows to prevent spawn errors
- Fix `dumpcap` path resolution for capture filter validation on Windows (`.exe` extension)
- Use `where` instead of `which` for binary lookup on Windows

## Documentation

- Updated CLAUDE.md, README.md, and USER_GUIDE.md with cross-platform instructions
- Added detailed **Settings Reference** table with all configuration parameters, environment variables, and defaults
- Added **mcpcap Configuration** guide with platform-specific installation paths and setup instructions
- Added auto-detection paths documentation for all supported binaries
- Added Windows-specific troubleshooting sections

## Notes

- The `.mcp.json` at the repo root is a macOS-only fallback. On Windows, configure mcpcap via the Settings page.
- Install mcpcap with `pip install mcpcap` and set the binary path in Settings.
- Process information on Windows uses PowerShell `Get-Process`; on macOS it uses `witr`.

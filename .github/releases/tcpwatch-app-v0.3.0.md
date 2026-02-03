# tcpwatch-app v0.3.0

## Features

- **Windows Support** - tcpwatch-app now builds for Windows (x64) in addition to macOS (arm64)
  - NSIS installer and portable zip distribution
  - PowerShell-based auto-updater
  - Windows-native tool path detection for Wireshark/tshark
  - Platform-specific process termination handling

- **Cross-Platform Architecture**
  - New platform abstraction layer for Go backend (`platform_darwin.go`, `platform_windows.go`)
  - Electron platform abstraction for tool paths (`platform.ts`)
  - Separate CI/CD workflows for each platform

## Build Outputs

- **macOS (arm64)**: dmg, zip, pkg
- **Windows (x64)**: NSIS installer (.exe), zip

## Notes

- Both platform builds are triggered automatically when a release tag is pushed
- Windows builds require Wireshark to be installed for packet capture functionality
- Auto-update now works on both platforms

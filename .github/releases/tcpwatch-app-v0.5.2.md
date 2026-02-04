# tcpwatch-app-v0.5.2

## Features

- Add Windows support to auto-updater: downloads NSIS installer and runs it silently (`/S --force-run`)
- Platform-aware update asset matching (NSIS `.exe` on Windows, arm64 `.zip` on macOS)

## Notes

- macOS updater logic is unchanged
- On Windows, the NSIS installer handles stopping the old app, replacing files, and relaunching

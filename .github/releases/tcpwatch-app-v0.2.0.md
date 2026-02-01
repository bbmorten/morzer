# tcpwatch-app-v0.2.0

## Features

- **Auto-update from GitHub releases** — The app now checks for updates automatically on every startup and offers to download and install new versions in-place. A "Check for Updates..." menu item is also available under the tcpwatch application menu.
- **Custom application menu** — Adds a standard macOS menu bar with About, Check for Updates, Edit, View, Window, and Help menus, replacing the default Electron menu.

## Details

- Update checks use the GitHub Releases API against `bbmorten/morzer` — no authentication required
- Downloads the ARM64 macOS ZIP asset, extracts with `ditto`, clears quarantine with `xattr -cr`, and replaces the running `.app` bundle
- Includes backup/restore logic in case the replacement fails
- The startup check runs 5 seconds after launch (packaged builds only) to avoid blocking the UI
- New IPC bridge methods (`checkForUpdate`, `getAppVersion`) exposed for future renderer-side integration

## Notes

- The auto-update feature only activates in packaged builds (skipped in development mode)
- Requires write permission to the directory containing the `.app` bundle
- No new npm dependencies were added

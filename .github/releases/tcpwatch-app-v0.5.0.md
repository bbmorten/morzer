# tcpwatch-app-v0.5.0

## Features

- Add Windows CI/CD pipeline (`tcpwatch-windows.yml`) that builds NSIS installer and zip on `tcpwatch-app-v*` tags
- Platform-specific `extraResources` in electron-builder config for correct binary bundling on macOS (`tcpwatch`) and Windows (`tcpwatch.exe`)
- Both macOS and Windows workflows now trigger on the same release tags and publish artifacts to the same GitHub Release

## Notes

- Windows builds produce x64 NSIS installer (`.exe`) and `.zip` archive
- macOS builds continue to produce arm64 `.zip` and `.pkg`

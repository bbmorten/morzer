# tcpwatch-app-v0.2.6

## Bug Fixes

- **Fix auto-update "Permission denied" on .app swap** — The update script now waits for all Electron helper processes (GPU, Renderer) to exit before attempting to replace the `.app` bundle, using `lsof` to detect lingering processes. The `mv` operation also retries up to 5 times with delays to handle brief macOS file locks.

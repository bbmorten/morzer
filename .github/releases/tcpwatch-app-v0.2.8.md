# tcpwatch-app-v0.2.8

## Bug Fixes

- **Fix auto-update for root-owned .app bundles** — When the installed `.app` is owned by root (e.g. from CI builds or sudo extraction), the updater now falls back to `osascript` with `with administrator privileges`, showing the standard macOS password dialog to authorize the swap. User-owned bundles continue to update silently without a prompt.

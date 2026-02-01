# tcpwatch-app-v0.2.4

## Bug Fixes

- **Fix auto-update restart flow** — The update script that swaps the `.app` bundle after quitting now runs reliably. The script is written to `/tmp` (outside the staging directory), the app waits 500ms before exiting to let the script fully start, and a log file (`/tmp/tcpwatch-update.log`) is written for diagnostics. Paths are now shell-safe quoted to handle spaces.

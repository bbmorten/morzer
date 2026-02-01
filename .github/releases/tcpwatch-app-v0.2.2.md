# tcpwatch-app-v0.2.2

## Bug Fixes

- **Fix auto-update EACCES error** — The updater no longer attempts to rename the running `.app` bundle in-process (which macOS blocks with EACCES). Instead, it downloads and stages the update, then spawns a detached shell script that waits for the app to exit before swapping the bundle and relaunching.
- **Fix capture filter validation** — Switched from `tshark -f <filter> -c 0` (which tshark rejects: "packet count is zero") to `dumpcap -f <filter> -d`, which compiles the BPF filter to bytecode without capturing.

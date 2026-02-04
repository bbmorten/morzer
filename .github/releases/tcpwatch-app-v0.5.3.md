# tcpwatch-app-v0.5.3

## Bug Fixes

- Fix mcpcap spawn ENOENT in packaged app: `resolveRepoRoot()` was returning the `app.asar` file path as `cwd`, causing Node.js `spawn` to fail. Now resolves to the parent resources directory.
- Revert the cmd.exe wrapping approach from v0.5.1 which broke dev mode

## Notes

- This is the correct fix for the mcpcap analyze feature on Windows packaged builds
- Dev mode and macOS are unaffected

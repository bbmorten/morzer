# tcpwatch-app-v0.5.1

## Bug Fixes

- Fix mcpcap `spawn ENOENT` error in packaged Windows app by routing commands through `cmd.exe` on Windows, resolving Microsoft Store Python executable path issues

## Notes

- Dev mode is unaffected; the `cmd.exe /c` wrapper is transparent for command execution

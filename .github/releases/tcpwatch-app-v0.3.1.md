# tcpwatch-app v0.3.1

## Features

- **Windows Process Info** - Added native PowerShell-based process information for Windows
  - Uses `Get-Process` and `Get-CimInstance Win32_Process` for detailed process data
  - Displays: process name, PID, path, command line, parent PID, start time, CPU time, memory usage, threads, handles, and window title
  - No longer requires `witr` to be installed on Windows

## Notes

- On macOS, the app continues to use `witr` for process information when available
- Windows users get native process info without any additional tool installation

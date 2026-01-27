# tcpwatch-app-v0.1.14

## Features

- **Right-click context menu for connections table**:
  - Replaced double-click kill action with a right-click context menu
  - Added "Info" option that runs `witr -p <pid>` to show process information
  - Added "Kill Process" option (moved from double-click)

- **Process Info integration**:
  - New modal displays process information from `witr` command
  - ANSI color codes are stripped for clean display
  - Shows helpful error message if `witr` is not installed

## Notes

- `witr` can be installed with: `go install github.com/morzer/witr@latest`
- Process info uses `witr -p <pid>` to get detailed process information

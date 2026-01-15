# tcpwatch (macOS) — User Guide

`tcpwatch` is a macOS desktop app that shows live TCP connections on your machine and (optionally) lets you terminate the owning process.

## Install

You can install via either:

- **PKG installer** (`tcpwatch-…​.pkg`): run it and follow the prompts.
- **ZIP** (`tcpwatch-…​.zip`): unzip, then drag `tcpwatch.app` into `/Applications`.

## Downloads / Releases

If you received the app from GitHub:

- **Releases page**: download the `.pkg` or `.zip` attached to a tagged release (tags look like `tcpwatch-app-vX.Y.Z`).
- **Actions artifacts**: maintainers can also download build artifacts from the `tcpwatch (macOS)` workflow run.

### First run / Gatekeeper

Because the app may be **unsigned** (developer builds), macOS may block it the first time.

- Finder → Applications → right‑click `tcpwatch` → **Open** → confirm.
- Or: System Settings → Privacy & Security → allow the blocked app.

#### Removing the quarantine attribute

If macOS shows "tcpwatch cannot be verified" or similar warnings, you can remove the quarantine attribute that macOS adds to downloaded files:

```bash
# For the PKG installer (before installing)
sudo xattr -rd com.apple.quarantine /path/to/tcpwatch-0.1.1-arm64.pkg

# For the installed binary (if already installed)
sudo xattr -rd com.apple.quarantine /usr/local/bin/tcpwatch

# For the app bundle
sudo xattr -rd com.apple.quarantine /Applications/tcpwatch.app
```

After running the appropriate command, you can install or run the app normally.

## What you see

Each row is a single TCP socket/connection.

Columns:

- **PROTO**: `tcp`, `tcp4`, `tcp6`
- **LOCAL**: local address + port
- **REMOTE**: remote address + port
- **STATE**: TCP state (e.g. `ESTABLISHED`, `LISTEN`, `CLOSE_WAIT`)
- **PID**: owning process ID
- **PROCESS**: process name (best effort; may be blank depending on permissions)

## Controls

### Start / Stop (streaming)

- **Start** begins streaming updates at the configured interval.
- **Stop** stops streaming.

While streaming, edits to filters (PID/Port/State/Process/Include LISTEN) automatically apply.

### Run once (snapshot)

- **Run once** fetches a single snapshot and updates the table.

## Packet capture (tshark)

The app can start a short packet capture using `tshark` (from Wireshark) and then split the capture into per-connection files.

### Prerequisites

- Install **Wireshark** (it includes the `tshark` CLI).
- Capturing packets may require elevated privileges or capture permissions on macOS.

### How to capture

1. Click **Start** (so tcpwatch is streaming).
2. In the **Capture (tshark)** section:
   - Choose a **Dump folder**
   - Pick an **Interface**
   - Set **Max duration** (1–300 seconds)
  - Optional: set the **Port** filter (under Filters) to scope capture to a single port.
3. Click **Start capture**.
4. Click **Stop capture** to stop early (otherwise it stops automatically at the max duration).

If **Port** is set, the app starts `tshark` with a capture filter `tcp port <port>`, so only matching traffic is written to the `.pcapng`.

### What happens after capture

- The app writes one capture file: `tcpwatch-capture-<timestamp>.pcapng`.
- After capture stops, it automatically **splits** by `tcp.stream` into a folder like:
  - `tcpwatch-split-<timestamp>/tcp-stream-00000.pcapng`, etc.
- It also writes `tcpwatch-split-<timestamp>/index.json` listing all generated stream files.

### Viewing split files

- Open the **Captures** page in the app.
- Select the split folder (or it will auto-select the most recent split from the last capture).
- Double-click a stream row to open the `.pcapng` in **Wireshark**.

## Filters

All filters are optional.

- **Interval (ms)**: refresh period. Lower = more CPU.
- **State CSV**: comma-separated states, e.g. `ESTABLISHED,CLOSE_WAIT`.
- **PID**: show only rows with that owning PID.
- **Port**: matches **local OR remote** port.
- **Process**: case-insensitive substring match against the process name.
- **Include LISTEN**: if unchecked, LISTEN sockets are excluded.

## Terminating a process (double-click)

To terminate the owning process for a row:

1. **Double-click** the row.
2. Confirm the prompt.

What happens:

- The app sends **SIGTERM** to that PID.
- If you don’t have permission, you’ll see an error like **“Permission denied”**.
- The app refuses to terminate protected PIDs (the app itself and its helper process).

Safety notes:

- Some processes may ignore SIGTERM.
- Terminating system processes can cause instability.
- If you need “force kill” behavior (SIGKILL), request it explicitly; it is not enabled by default.

## Permissions & missing process names

macOS may restrict visibility into other processes.

If you see missing `PROCESS` names or can’t terminate a PID:

- Try running the CLI directly from Terminal as admin (for debugging):

  ```bash
  cd tools/tcpwatch
  sudo ./tcpwatch
  ```

- For the desktop app, you typically need to run it normally; it will show what macOS allows.

## Troubleshooting

### App window is blank

Run the app from Terminal to capture logs:

```bash
OPEN_DEVTOOLS=1 ELECTRON_ENABLE_LOGGING=1 /Applications/tcpwatch.app/Contents/MacOS/tcpwatch
```

This opens DevTools and prints main/renderer load diagnostics to the terminal.

### No data / empty table

- Try **Run once**.
- Remove all filters (PID/Port/State/Process) and try again.
- Ensure **Include LISTEN** is enabled if you expect LISTEN sockets.

## Uninstall

- If installed via ZIP: delete `/Applications/tcpwatch.app`.
- If installed via PKG: you can still remove `/Applications/tcpwatch.app` (the installer does not create required system services).

## Privacy

The app reads local network socket metadata and process names (when available). It does not send that data anywhere by default.

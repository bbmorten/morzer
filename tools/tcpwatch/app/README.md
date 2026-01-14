# tcpwatch (Electron)

This is the macOS Electron UI for the `tcpwatch` Go CLI.

## Prereqs

- Node.js + npm
- A built `tcpwatch` binary at `tools/tcpwatch/tcpwatch`

Build the binary:

```bash
cd tools/tcpwatch
go build -o tcpwatch
```

## Dev

```bash
cd tools/tcpwatch/app
npm install
npm run dev
```

## Packaging (unsigned)

```bash
cd tools/tcpwatch/app
npm run pack:dir
```

The app expects the `tcpwatch` binary to be bundled via `extraResources`.

## Notes

- You can override the binary path with `TCPWATCH_BIN=/abs/path/to/tcpwatch`.
- The UI consumes `tcpwatch -jsonl` (NDJSON snapshots).

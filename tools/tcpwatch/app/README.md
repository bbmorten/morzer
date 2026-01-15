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

## Downloadable builds (GitHub Actions)

This repo includes a workflow that builds and uploads macOS artifacts (`.pkg` + `.zip`) so they can be downloaded from GitHub.

- Manual: run the `tcpwatch (macOS)` workflow via **Actions** → select a run → download the artifacts.
- Release assets: push a tag like `tcpwatch-app-v0.1.1` and the workflow will attach the artifacts to the GitHub Release for that tag.

Tag example:

```bash
git tag tcpwatch-app-v0.1.1
git push origin tcpwatch-app-v0.1.1
```

The app expects the `tcpwatch` binary to be bundled via `extraResources`.

## Notes

- You can override the binary path with `TCPWATCH_BIN=/abs/path/to/tcpwatch`.
- The UI consumes `tcpwatch -jsonl` (NDJSON snapshots).

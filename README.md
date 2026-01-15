# tcpwatch (Electron)

Looking for end-user instructions? See: `USER_GUIDE.md`.

This is the macOS Electron UI for the `tcpwatch` Go CLI.

## Quick Start

### 1) Install

- If you have a `.pkg` installer: run it.
- If you have a `.zip`: unzip and drag `tcpwatch.app` into `/Applications`.

If macOS blocks the app (unsigned builds), use Finder → right‑click `tcpwatch` → **Open**.

### 2) Use

- Click **Run once** to take a single snapshot.
- Click **Start** to stream updates; change filters while running to apply instantly.
- Double‑click a row to terminate that row’s PID (after confirmation).
- Use **Capture (tshark)** to record traffic and split by connection; if **Port** is set, the capture is limited to `tcp port <port>`.

For details (filters, troubleshooting, permissions), see `USER_GUIDE.md`.

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
git tag tcpwatch-app-vX.Y.Z
git push origin tcpwatch-app-vX.Y.Z
```

Maintainers: see `.github/specs/tcpwatch-release.md` for the release/packaging checklist.

The app expects the `tcpwatch` binary to be bundled via `extraResources`.

## Notes

- You can override the binary path with `TCPWATCH_BIN=/abs/path/to/tcpwatch`.
- The UI consumes `tcpwatch -jsonl` (NDJSON snapshots).

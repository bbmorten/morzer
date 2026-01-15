---
name: tcpwatch-electron
description: Project-specific guidance for the tcpwatch macOS Electron app (Go tcpwatch CLI + Electron/React UI). Includes required change checklist and validation steps.
---

# tcpwatch Electron (Project Skill)

## What this is

This skill documents project-specific workflows and expectations for the `tools/tcpwatch` Go CLI and the Electron app in `tools/tcpwatch/app`.

## Change checklist (must follow)

When you implement a change (code, packaging, workflow, docs):

1. Update docs
	- Update `README.md` for quick-start / high-level user-facing changes.
	- Update `USER_GUIDE.md` for detailed user-facing behavior, troubleshooting, and permissions.

2. Keep contracts in sync
	- If IPC changes, update both:
		- `tools/tcpwatch/app/electron/preload.cjs` (exposed API)
		- `tools/tcpwatch/app/src/renderer/types.ts` (TypeScript typings)

3. Validate locally (when feasible)
	- From `tools/tcpwatch/app`:
		- `npm run typecheck`
		- `npm run build:electron`
	- If UI/build outputs moved, verify packaging inputs include the correct renderer output folder (currently `renderer-dist`).

## Repo conventions worth remembering

- Renderer build output is `tools/tcpwatch/app/renderer-dist` (to avoid collisions with electron-builder output `dist`).
- Packet capture uses `tshark`.
	- Capture filters use `tshark -f` (BPF). Display filters would be `-Y` (Wireshark filter syntax).
	- If the UI has a port filter, capture should be scoped accordingly (currently `tcp port <port>`).
	- Split output `index.json` includes per-stream endpoints and best-effort reverse-DNS hostnames.
		- Reverse DNS can be disabled with `TCPWATCH_RDNS=0`.
		- Tuning: `TCPWATCH_RDNS_TIMEOUT_MS` and `TCPWATCH_RDNS_CONCURRENCY`.
	- Captures UI can import external `.pcap/.pcapng` files by auto-splitting and generating `index.json`.
		- Also supports drag & drop onto the Captures page.

## Release / packaging

- See `.github/specs/tcpwatch-release.md` for the release checklist and tag/version rules.

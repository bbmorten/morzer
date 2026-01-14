---
name: electron-macos
description: Build, debug, package, sign, and ship Electron apps for macOS (darwin). Use when developing macOS-specific Electron features (menu bar, deep links, permissions/TCC, keychain), configuring packaging (electron-builder / electron-forge), producing arm64/x64/universal builds, and handling distribution requirements (hardened runtime, entitlements, codesigning, notarization with notarytool, Gatekeeper troubleshooting, auto-updates).
---

# Electron macOS

## Overview

Develop Electron apps that behave like first-class macOS applications and reliably pass Gatekeeper.

Prioritize repeatable builds (arm64/x64/universal), correct signing, and notarization.

## Workflow Decision Tree

1. Choose distribution target
	- **Internal/dev only** → unsigned builds are OK.
	- **Direct download (DMG/ZIP/PKG)** → Developer ID signing + hardened runtime + notarization.
	- **Mac App Store (MAS)** → sandboxing + MAS-specific entitlements + provisioning profile.

2. Choose architecture strategy
	- **arm64 only** (Apple Silicon) or **x64 only** (Intel) if you control the fleet.
	- **universal** if you ship broadly and want one artifact.

3. Choose packaging toolchain
	- Prefer **electron-builder** when you need a wide matrix of targets and signing automation.
	- Prefer **electron-forge** when you want a modern, modular pipeline (makers/publishers).

If you need the signing/notarization specifics, load `references/distribution.md`.
If you need Electron-friendly entitlements, load `references/entitlements.md`.
If you need update guidance, load `references/auto-update.md`.

## Local Development (macOS)

1. Verify prerequisites
	- Xcode Command Line Tools installed.
	- Node.js toolchain matches your project.
	- For native modules, plan to rebuild per-arch.

2. Debug effectively
	- Use renderer DevTools for web UI.
	- Use `--inspect` / `--inspect-brk` for main process debugging.
	- Keep IPC contracts typed and versioned; many “mac-only” issues are actually timing/IPC.

3. macOS integration hot spots
	- **Permissions/TCC**: camera/mic/screen recording/location require correct macOS usage descriptions and user approval flows.
	- **Keychain**: prefer the system Keychain APIs (or battle-tested libraries) and handle access groups/sandbox if MAS.
	- **Deep links**: register URL schemes and handle cold-start vs already-running cases.
	- **Menu bar / tray**: handle app lifecycle differences (closing windows is not quitting).

## Packaging & Shipping (Direct Download)

Follow this order to avoid “signed wrong thing” dead ends:

1. Produce a release build (unsigned)
	- Build for `arm64`, `x64`, or `universal`.
	- Prefer deterministic versioning and clean build directories.

2. Sign the app bundle correctly
	- Sign *all* nested code (helper apps, frameworks, dylibs) with a Developer ID Application identity.
	- Enable hardened runtime.
	- Use appropriate entitlements (Electron commonly needs JIT-related ones).

3. Notarize the distributable artifact
	- Notarize a DMG/ZIP/PKG using `xcrun notarytool`.
	- Staple the ticket, then verify with `spctl`.

For a step-by-step checklist (including verification commands and common failures), read `references/distribution.md`.

## Common Failure Modes (Fast Triage)

- **Gatekeeper says “damaged” / “can’t be opened”**: usually missing notarization, missing stapling, or broken/quarantined packaging. Verify with `spctl` and `codesign`.
- **Notarization fails**: typically unsigned nested binaries, invalid entitlements, or forbidden hardened runtime settings. Inspect the notary log.
- **App runs locally but fails on another Mac**: often keychain access, missing permissions prompts, or missing resources due to packaging config.
- **Universal build issues**: native modules or helper binaries not universal. Ensure per-arch rebuild/merge.

## References (Load On Demand)

- `references/distribution.md`: Developer ID signing + hardened runtime + notarization + verification workflow.
- `references/entitlements.md`: Practical entitlements for Electron helpers/frameworks and what to avoid.
- `references/auto-update.md`: Update strategy choices and common macOS constraints.

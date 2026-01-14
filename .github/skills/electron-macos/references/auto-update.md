# Auto-update on macOS (Electron)

Use this guide when adding or fixing updates for an Electron macOS app.

## Choose an Update Strategy

1. **Built-in electron-updater (common)**
- Works well for direct-download apps.
- Usually expects signed artifacts and a publish provider (GitHub Releases / S3 / custom).

2. **MAS distribution**
- Updates are handled by the App Store.
- Do not ship your own updater.

3. **No auto-update**
- Provide an in-app “Check for updates” that opens your downloads page.

## Practical macOS Constraints

- Updates should be **signed**; otherwise replacement may fail or trip Gatekeeper.
- If you notarize releases, keep the pipeline consistent: sign → notarize → staple → publish.
- Universal vs per-arch updates: ensure your update feed matches what the installed app expects.

## Common Failure Modes

- Update downloads but won’t install:
  - signature mismatch, wrong artifact type, or insufficient permissions.

- Update works on one machine but not others:
  - differences in quarantine state, permissions prompts, or per-user install location.

- “App is damaged” after update:
  - updated bundle not notarized/stapled or packaging altered after signing.

## What to Collect When Debugging

- App version + Electron version
- Distribution channel (DMG/ZIP/PKG, or MAS)
- Architecture (arm64/x64/universal)
- Signing identity type (Developer ID vs ad-hoc)
- Updater library + provider config

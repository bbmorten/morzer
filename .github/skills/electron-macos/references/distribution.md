# Distribution (Developer ID): sign + notarize + verify

Use this guide when shipping **direct download** macOS artifacts (DMG/ZIP/PKG) for an Electron app.

Assume:
- You are enrolled in the Apple Developer Program.
- You have a **Developer ID Application** certificate in the login keychain.
- You are targeting modern macOS Gatekeeper requirements: **hardened runtime + notarization**.

## Checklist (Recommended Order)

1. Build release artifacts (unsigned or ad-hoc)
2. Deep sign the `.app` bundle (hardened runtime + entitlements)
3. Package (`dmg`, `zip`, or `pkg`)
4. Notarize the packaged artifact
5. Staple the notarization ticket
6. Verify with `codesign` and `spctl`

## Verification Commands

### Inspect signing

- Show signature + entitlements:
  - `codesign -dv --verbose=4 --entitlements :- "MyApp.app"`

- Verify deeply:
  - `codesign --verify --deep --strict --verbose=4 "MyApp.app"`

### Gatekeeper assessment

- Verify acceptance:
  - `spctl -a -vvv --type execute "MyApp.app"`
  - `spctl -a -vvv --type open "MyApp.dmg"`

## Notarization (notarytool)

Use `xcrun notarytool` (preferred over legacy `altool`).

### One-time setup

- Store an App Store Connect API key profile (recommended) or an Apple ID app-specific password.
- Confirm your Team ID.

### Submit and wait

- `xcrun notarytool submit "MyApp.dmg" --wait --team-id <TEAM_ID> --apple-id <APPLE_ID> --password <APP_SPECIFIC_PASSWORD>`

If you use a keychain profile:
- `xcrun notarytool submit "MyApp.dmg" --wait --keychain-profile "notary-profile"`

### Staple

- `xcrun stapler staple "MyApp.app"`
- If you notarized a DMG, staple the DMG too:
  - `xcrun stapler staple "MyApp.dmg"`

## electron-builder Notes

When using electron-builder, prefer its built-in signing/notarization support.

Common config knobs (names vary by version):
- Enable hardened runtime.
- Provide entitlements for app + helpers (inherit).
- Ensure all helper apps/frameworks are signed.
- Configure notarization credentials via environment variables / CI secrets.

If builds pass locally but fail in CI, suspect:
- Missing certificates in CI keychain.
- Wrong keychain unlock / partition list.
- Notarization credentials not available.

## Troubleshooting Patterns

### Notarization says “The binary is not signed”

- One or more nested binaries aren’t signed.
- Run:
  - `codesign --verify --deep --strict --verbose=4 "MyApp.app"`
- Re-check helpers under:
  - `MyApp.app/Contents/Frameworks/`

### Notarization says “invalid entitlements”

- You likely applied entitlements that are not allowed for Developer ID or are mis-scoped.
- Re-check:
  - app entitlements vs helper/inherit entitlements.
- Load `references/entitlements.md` and ensure your entitlements are minimal.

### Gatekeeper shows “damaged”

Common causes:
- Not notarized or not stapled.
- Packaging modifies the bundle after signing.
- Translocation/quarantine edge cases.

Action:
- Sign → package → notarize → staple (never modify after signing).
- Verify with `spctl -a -vvv` on a clean machine/user account.

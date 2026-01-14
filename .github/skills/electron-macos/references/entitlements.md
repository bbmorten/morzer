# Entitlements & Hardened Runtime (Electron on macOS)

Use this reference when your Electron app fails to run under hardened runtime, crashes on launch after signing, or notarization rejects your submission.

Goal: keep entitlements **minimal** and correctly scoped.

## Key Concepts

- **Hardened runtime** is required for notarization (Developer ID distribution).
- Electron often requires JIT-related entitlements (depending on Electron version and features).
- Entitlements differ between:
  - the main app binary
  - helper apps
  - inherited contexts (frameworks/helpers)

## Common Electron-Friendly Entitlements

These are commonly needed for Electron apps that use V8 JIT:

- `com.apple.security.cs.allow-jit`
- `com.apple.security.cs.allow-unsigned-executable-memory`

Sometimes needed (use only if required):

- `com.apple.security.cs.disable-library-validation`
  - Needed if you load unsigned/third-party code into your process (plugins, some native modules).
  - Avoid unless you have a clear reason.

## Typical Files

Many Electron packagers use three entitlements files:

1. App entitlements (for the main app)
2. Helper entitlements (for helper app binaries)
3. Inherit entitlements (for nested code that should inherit)

## Practical Rules

- Apply **the most permissive entitlements only where required** (usually main + helpers).
- Prefer an “inherit” entitlements file for frameworks/helpers that don’t need special rights.
- Do not add unrelated entitlements “just in case” — they can break notarization.

## Debugging

- Print entitlements applied to a signed app:
  - `codesign -dv --entitlements :- "MyApp.app"`

- Verify deep signature:
  - `codesign --verify --deep --strict --verbose=4 "MyApp.app"`

If a crash happens only when signed:
- suspect hardened runtime restrictions
- reduce entitlements to the minimum and re-test

## MAS vs Developer ID

- Mac App Store builds require sandboxing and different entitlements/provisioning.
- Do not reuse MAS entitlements for Developer ID notarization.

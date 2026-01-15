# tcpwatch release & packaging checklist

This document is for maintainers who build and publish macOS artifacts (`.zip` + `.pkg`) via GitHub Actions.

## What gets built

- Workflow: `.github/workflows/tcpwatch-macos.yml` (name: **tcpwatch (macOS)**)
- Outputs (arm64):
	- `tools/tcpwatch/app/dist/*.zip`
	- `tools/tcpwatch/app/dist/*.pkg`
	- optional `*.blockmap`

## Versioning and tags

Preferred tag format:

- `tcpwatch-app-vX.Y.Z`

Notes:

- The workflow derives the app version from the tag by stripping `tcpwatch-app-v` (or `tcpwatch-v`) and passes it to `electron-builder` as `--config.extraMetadata.version`.
- Make sure the tag points at a commit that includes `.github/workflows/tcpwatch-macos.yml`, otherwise GitHub won’t run the workflow.

Tag commands:

```bash
git tag tcpwatch-app-vX.Y.Z
git push origin tcpwatch-app-vX.Y.Z
```

## Release process (recommended)

1. Ensure `main` is green locally (optional but recommended)
	- From `tools/tcpwatch/app`: `npm run typecheck && npm run build`

2. Push a tag
	- `tcpwatch-app-vX.Y.Z`

3. Verify the GitHub Actions run
	- Actions → **tcpwatch (macOS)** → confirm it produced `.zip` and `.pkg` artifacts.

4. Verify release assets
	- The workflow uploads artifacts to the workflow run and also attaches them to the GitHub Release for the tag.
	- If there is no Release yet, the publish step will create one.

## Manual publish / re-publish

Use **workflow_dispatch** and set `release_tag`:

- `release_tag=tcpwatch-app-vX.Y.Z`

This is useful if you need to regenerate artifacts for an existing tag (for example, if the previous workflow run failed).

## Common failure modes

- **No workflow run triggered**: tag points at a commit without the workflow file.
- **No `.pkg`/`.zip` produced**: check electron-builder logs; ensure renderer output is `renderer-dist` and packaging includes it.
- **Gatekeeper warnings**: expected for unsigned builds; see `USER_GUIDE.md` Gatekeeper/quarantine instructions.

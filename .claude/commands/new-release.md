# Release Skill

Create a new release for tcpwatch-app (macOS and Windows).

## Overview

This skill creates a new release that triggers CI/CD builds for both macOS (arm64) and Windows (x64) platforms. The tag push triggers:
- `.github/workflows/tcpwatch-macos.yml` - Builds macOS dmg, zip, and pkg
- `.github/workflows/tcpwatch-windows.yml` - Builds Windows NSIS installer and zip

## Instructions

When the user runs `/new-release`, follow these steps:

### 1. Check for uncommitted changes
Run `git status` to see if there are uncommitted changes. If there are changes:
- Review the changes with `git diff`
- Ask the user if they want to include these changes in the release

### 2. Determine the new version
- Read the current version from `tools/tcpwatch/app/package.json`
- Bump the patch version (e.g., 0.1.13 -> 0.1.14)
- Ask the user to confirm the new version or let them specify a different one

### 3. Update package.json
- Update the `version` field in `tools/tcpwatch/app/package.json` to the new version

### 4. Create release notes
- Create a new file at `.github/releases/tcpwatch-app-v{VERSION}.md`
- Use this template:

```markdown
# tcpwatch-app-v{VERSION}

## Features

- [List new features added in this release]

## Bug Fixes

- [List bug fixes if any]

## Notes

- [Any additional notes]
```

- Ask the user to describe the changes for the release notes, or generate them from the git diff

### 5. Commit the changes
- Stage all changes: the modified files, updated package.json, and new release notes
- Create a commit with message: `Release tcpwatch-app v{VERSION}`
- Include the co-author line

### 6. Optional: Tag and push
- Ask the user if they want to:
  - Create a git tag: `tcpwatch-app-v{VERSION}`
  - Push to remote

### 7. Create GitHub Release
After the tag is pushed, create a GitHub release:
```bash
gh release create tcpwatch-app-v{VERSION} -F .github/releases/tcpwatch-app-v{VERSION}.md
```

## Example Usage

User: `/new-release`
Assistant: I'll help you create a new release. Let me check the current state...

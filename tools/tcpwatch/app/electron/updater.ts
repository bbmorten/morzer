import { app, dialog, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn as spawnChild, spawnSync } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'

const GITHUB_OWNER = 'bbmorten'
const GITHUB_REPO = 'morzer'
const TAG_PREFIX = 'tcpwatch-app-v'

export type UpdateInfo = {
  currentVersion: string
  latestVersion: string
  releaseTag: string
  releaseUrl: string
  downloadUrl: string
  releaseNotes: string
  publishedAt: string
}

export type UpdateCheckResult =
  | { available: false; currentVersion: string }
  | { available: true; info: UpdateInfo }

/* ------------------------------------------------------------------ */
/*  Version helpers                                                    */
/* ------------------------------------------------------------------ */

/** Parse "X.Y.Z" into [major, minor, patch]. Returns null on bad input. */
function parseSemver(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v)
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** Return >0 if a > b, <0 if a < b, 0 if equal. */
function compareVersions(a: string, b: string): number {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (!pa || !pb) return 0
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i]
  }
  return 0
}

/** Extract version from tag like "tcpwatch-app-v0.1.15" → "0.1.15" */
function versionFromTag(tag: string): string | null {
  if (!tag.startsWith(TAG_PREFIX)) return null
  const v = tag.slice(TAG_PREFIX.length)
  return parseSemver(v) ? v : null
}

/* ------------------------------------------------------------------ */
/*  GitHub API                                                         */
/* ------------------------------------------------------------------ */

type GitHubRelease = {
  tag_name: string
  html_url: string
  body?: string
  draft: boolean
  prerelease: boolean
  published_at?: string
  assets: Array<{
    name: string
    browser_download_url: string
    size: number
  }>
}

let checking = false

export async function checkForUpdate(currentVersion: string): Promise<UpdateCheckResult> {
  if (checking) return { available: false, currentVersion }
  checking = true
  try {
    const resp = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `tcpwatch/${currentVersion}`,
        },
      },
    )
    if (!resp.ok) {
      throw new Error(`GitHub API returned ${resp.status}: ${resp.statusText}`)
    }
    const releases = (await resp.json()) as GitHubRelease[]

    // Filter to tcpwatch-app releases that are not drafts/prereleases
    let best: { version: string; release: GitHubRelease } | null = null
    for (const rel of releases) {
      if (rel.draft || rel.prerelease) continue
      const v = versionFromTag(rel.tag_name)
      if (!v) continue
      if (!best || compareVersions(v, best.version) > 0) {
        best = { version: v, release: rel }
      }
    }

    if (!best || compareVersions(best.version, currentVersion) <= 0) {
      return { available: false, currentVersion }
    }

    // Find the arm64 mac zip asset
    const zipAsset = best.release.assets.find((a) =>
      a.name.match(/^tcpwatch-.*-arm64-mac\.zip$/),
    )
    if (!zipAsset) {
      return { available: false, currentVersion }
    }

    return {
      available: true,
      info: {
        currentVersion,
        latestVersion: best.version,
        releaseTag: best.release.tag_name,
        releaseUrl: best.release.html_url,
        downloadUrl: zipAsset.browser_download_url,
        releaseNotes: best.release.body ?? '',
        publishedAt: best.release.published_at ?? '',
      },
    }
  } finally {
    checking = false
  }
}

/* ------------------------------------------------------------------ */
/*  Download & Install                                                 */
/* ------------------------------------------------------------------ */

export async function downloadAndInstallUpdate(
  info: UpdateInfo,
  parentWindow?: BrowserWindow | null,
): Promise<void> {
  if (!app.isPackaged) {
    dialog.showErrorBox('Update Error', 'Cannot update in development mode.')
    return
  }

  // Determine the running .app bundle path
  const exePath = app.getPath('exe') // e.g. /Applications/tcpwatch.app/Contents/MacOS/tcpwatch
  const appBundlePath = path.resolve(exePath, '..', '..', '..') // .app directory
  if (!appBundlePath.endsWith('.app')) {
    dialog.showErrorBox(
      'Update Error',
      `Cannot determine app bundle path. Executable: ${exePath}`,
    )
    return
  }

  const parentDir = path.dirname(appBundlePath)

  // Check write permission on the parent directory
  try {
    fs.accessSync(parentDir, fs.constants.W_OK)
  } catch {
    dialog.showErrorBox(
      'Update Error',
      `No write permission to ${parentDir}.\nMove tcpwatch.app to a location where you have write access, or run the update manually.`,
    )
    return
  }

  // Create a persistent staging directory (not in /tmp which may get cleaned)
  // We use a sibling directory next to the .app so it's on the same filesystem
  // (required for atomic mv) and survives the app restart.
  const stagingDir = path.join(parentDir, '.tcpwatch-update-staging')
  if (fs.existsSync(stagingDir)) {
    fs.rmSync(stagingDir, { recursive: true, force: true })
  }
  fs.mkdirSync(stagingDir, { recursive: true })

  const zipPath = path.join(stagingDir, 'update.zip')
  const extractDir = path.join(stagingDir, 'extracted')
  fs.mkdirSync(extractDir, { recursive: true })

  try {
    console.log(`[updater] Downloading ${info.downloadUrl}`)
    const resp = await fetch(info.downloadUrl, {
      headers: { 'User-Agent': `tcpwatch/${info.currentVersion}` },
    })
    if (!resp.ok) {
      throw new Error(`Download failed: ${resp.status} ${resp.statusText}`)
    }
    if (!resp.body) {
      throw new Error('Download failed: no response body')
    }

    // Stream the download to disk
    const nodeStream = Readable.fromWeb(resp.body as import('stream/web').ReadableStream)
    await pipeline(nodeStream, createWriteStream(zipPath))
    console.log(`[updater] Downloaded to ${zipPath}`)

    // Extract using macOS ditto (preserves resource forks and extended attributes)
    const dittoResult = spawnSync('ditto', ['-xk', zipPath, extractDir], {
      timeout: 120_000,
    })
    if (dittoResult.status !== 0) {
      throw new Error(
        `Extraction failed: ${dittoResult.stderr?.toString() || 'unknown error'}`,
      )
    }
    console.log(`[updater] Extracted to ${extractDir}`)

    // Find the .app bundle in the extracted directory
    const entries = fs.readdirSync(extractDir)
    const newAppName = entries.find((e) => e.endsWith('.app'))
    if (!newAppName) {
      throw new Error('No .app bundle found in the downloaded archive')
    }
    const newAppPath = path.join(extractDir, newAppName)

    // Remove quarantine attributes
    const xattrResult = spawnSync('xattr', ['-cr', newAppPath], {
      timeout: 30_000,
    })
    if (xattrResult.status !== 0) {
      console.warn(
        `[updater] xattr -cr warning: ${xattrResult.stderr?.toString()}`,
      )
    }
    console.log(`[updater] Cleared quarantine on ${newAppPath}`)

    // Remove the downloaded zip to save space (we only need the extracted app)
    try { fs.unlinkSync(zipPath) } catch { /* ignore */ }

    // Write a shell script to /tmp (independent of staging dir) that will:
    // 1. Wait for the current process to exit
    // 2. Replace the old .app with the new one
    // 3. Relaunch the new app
    // 4. Clean up
    //
    // This is necessary because macOS locks files inside a running .app bundle,
    // so we cannot rename/replace it while the process is alive.
    const scriptPath = path.join(os.tmpdir(), `tcpwatch-update-${Date.now()}.sh`)
    const logPath = path.join(os.tmpdir(), 'tcpwatch-update.log')
    const pid = process.pid
    const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'` // shell-safe single-quoting
    const script = [
      '#!/bin/bash',
      `LOG=${q(logPath)}`,
      `echo "[$(date)] Update script started (waiting for PID ${pid})" > "$LOG"`,
      '',
      '# Wait for the main app process to exit (up to 30 seconds)',
      'for i in $(seq 1 60); do',
      `  kill -0 ${pid} 2>/dev/null || break`,
      '  sleep 0.5',
      'done',
      `echo "[$(date)] Main process ${pid} exited" >> "$LOG"`,
      '',
      `APP=${q(appBundlePath)}`,
      `NEW=${q(newAppPath)}`,
      `STAGING=${q(stagingDir)}`,
      'BACKUP="${APP}.backup"',
      '',
      '# Wait for ALL processes inside the .app bundle to exit (Electron helpers)',
      '# Electron spawns GPU, Renderer, and other helper processes that linger',
      'for i in $(seq 1 20); do',
      '  PIDS=$(lsof -t "$APP" 2>/dev/null)',
      '  if [ -z "$PIDS" ]; then',
      '    break',
      '  fi',
      '  echo "[$(date)] Waiting for helper processes: $PIDS" >> "$LOG"',
      '  sleep 0.5',
      'done',
      'echo "[$(date)] All processes exited" >> "$LOG"',
      '',
      '# Remove any previous backup',
      'rm -rf "$BACKUP"',
      '',
      '# Helper: write a swap script for privileged execution',
      'SWAP_SCRIPT="/tmp/tcpwatch-swap-$$.sh"',
      'cat > "$SWAP_SCRIPT" << SWAPEOF',
      '#!/bin/bash',
      'rm -rf "$BACKUP"',
      'mv "$APP" "$BACKUP" && mv "$NEW" "$APP" && rm -rf "$BACKUP" && rm -rf "$STAGING"',
      'SWAPEOF',
      'chmod +x "$SWAP_SCRIPT"',
      '',
      '# Try normal mv first; if it fails (e.g. root-owned .app), escalate via osascript',
      'if mv "$APP" "$BACKUP" 2>> "$LOG"; then',
      '  echo "[$(date)] Moved old app to backup" >> "$LOG"',
      '  if mv "$NEW" "$APP" 2>> "$LOG"; then',
      '    echo "[$(date)] Moved new app into place" >> "$LOG"',
      '    rm -rf "$BACKUP"',
      '    rm -rf "$STAGING"',
      `    rm -f ${q(scriptPath)} "$SWAP_SCRIPT"`,
      '    echo "[$(date)] Relaunching app" >> "$LOG"',
      '    open "$APP"',
      '  else',
      '    echo "[$(date)] ERROR: Failed to move new app, restoring backup" >> "$LOG"',
      '    mv "$BACKUP" "$APP" 2>> "$LOG"',
      '    rm -rf "$STAGING"',
      `    rm -f ${q(scriptPath)} "$SWAP_SCRIPT"`,
      '  fi',
      'else',
      '  echo "[$(date)] Normal mv failed, requesting admin privileges via osascript..." >> "$LOG"',
      '  if osascript -e "do shell script \\"/bin/bash $SWAP_SCRIPT\\" with administrator privileges" 2>> "$LOG"; then',
      '    echo "[$(date)] Admin swap succeeded" >> "$LOG"',
      `    rm -f ${q(scriptPath)} "$SWAP_SCRIPT"`,
      '    echo "[$(date)] Relaunching app" >> "$LOG"',
      '    open "$APP"',
      '  else',
      '    echo "[$(date)] ERROR: Admin swap failed or was cancelled by user" >> "$LOG"',
      '    rm -rf "$STAGING"',
      `    rm -f ${q(scriptPath)} "$SWAP_SCRIPT"`,
      '  fi',
      'fi',
    ].join('\n') + '\n'

    fs.writeFileSync(scriptPath, script, { mode: 0o755 })
    console.log(`[updater] Wrote update script to ${scriptPath}`)
    console.log(`[updater] Log file: ${logPath}`)

    // Prompt the user to restart
    const restartChoice = dialog.showMessageBoxSync(
      parentWindow ? parentWindow : undefined!,
      {
        type: 'info',
        title: 'Update Ready',
        message: `tcpwatch v${info.latestVersion} has been downloaded.`,
        detail: 'The application needs to restart to apply the update. The swap will happen automatically after quitting.',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
      },
    )

    if (restartChoice === 0) {
      // Launch the detached update script via nohup, then quit.
      // Use 'open -a Terminal' fallback would be too visible; instead
      // nohup + setsid (detached) ensures the script survives our exit.
      const child = spawnChild('/bin/bash', [scriptPath], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
      })
      child.unref()
      console.log(`[updater] Launched update script (pid ${child.pid}), exiting in 500ms`)
      // Give the child process time to fully start before we exit
      setTimeout(() => app.exit(0), 500)
    }
    // If "Later", the staging dir stays around; the script can be run manually
    // or the next update check will clean it up and re-download.
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[updater] Update failed:`, message)
    dialog.showErrorBox('Update Failed', message)
    // Clean up staging on error
    try {
      fs.rmSync(stagingDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  }
}

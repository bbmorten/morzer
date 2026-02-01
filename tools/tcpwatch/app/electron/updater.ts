import { app, dialog, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
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
  const appName = path.basename(appBundlePath) // "tcpwatch.app"

  // Check write permission
  try {
    fs.accessSync(parentDir, fs.constants.W_OK)
  } catch {
    dialog.showErrorBox(
      'Update Error',
      `No write permission to ${parentDir}.\nMove tcpwatch.app to a location where you have write access, or run the update manually.`,
    )
    return
  }

  // Create temp directory
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcpwatch-update-'))
  const zipPath = path.join(tmpDir, 'update.zip')
  const extractDir = path.join(tmpDir, 'extracted')
  fs.mkdirSync(extractDir, { recursive: true })

  try {
    // Download
    const owner = parentWindow ?? undefined
    const progressNotification = owner
      ? undefined // Could add a progress window in the future
      : undefined

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

    // Replace the current app bundle
    const backupPath = path.join(parentDir, `${appName}.backup`)

    // Clean up any previous backup
    if (fs.existsSync(backupPath)) {
      fs.rmSync(backupPath, { recursive: true, force: true })
    }

    // Backup current → move new → clean backup
    fs.renameSync(appBundlePath, backupPath)
    try {
      fs.renameSync(newAppPath, appBundlePath)
    } catch (moveErr) {
      // Restore backup on failure
      console.error(`[updater] Move failed, restoring backup:`, moveErr)
      fs.renameSync(backupPath, appBundlePath)
      throw moveErr
    }

    // Remove backup
    try {
      fs.rmSync(backupPath, { recursive: true, force: true })
    } catch {
      // Non-critical
    }

    console.log(`[updater] App updated to v${info.latestVersion}`)

    // Prompt restart
    const restartChoice = dialog.showMessageBoxSync(
      parentWindow ? parentWindow : undefined!,
      {
        type: 'info',
        title: 'Update Installed',
        message: `tcpwatch has been updated to v${info.latestVersion}.`,
        detail: 'The application needs to restart to apply the update.',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
      },
    )

    if (restartChoice === 0) {
      app.relaunch()
      app.exit(0)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[updater] Update failed:`, message)
    dialog.showErrorBox('Update Failed', message)
  } finally {
    // Clean up temp directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  }
}

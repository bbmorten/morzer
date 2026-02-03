/**
 * Platform abstraction for cross-platform tool path resolution and utilities.
 */

import * as path from 'node:path'
import * as os from 'node:os'
import * as fs from 'node:fs'
import { spawnSync, type ChildProcess } from 'node:child_process'

const isWindows = process.platform === 'win32'
const isDarwin = process.platform === 'darwin'

/**
 * Returns candidate paths for the tshark binary.
 */
export function getTsharkCandidates(): string[] {
  if (isWindows) {
    const pf = process.env.PROGRAMFILES || 'C:\\Program Files'
    const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'
    return [
      path.join(pf, 'Wireshark', 'tshark.exe'),
      path.join(pf86, 'Wireshark', 'tshark.exe'),
    ]
  }
  return [
    '/Applications/Wireshark.app/Contents/MacOS/tshark',
    '/usr/local/bin/tshark',
    '/opt/homebrew/bin/tshark',
  ]
}

/**
 * Returns candidate paths for the editcap binary.
 */
export function getEditcapCandidates(): string[] {
  if (isWindows) {
    const pf = process.env.PROGRAMFILES || 'C:\\Program Files'
    const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'
    return [
      path.join(pf, 'Wireshark', 'editcap.exe'),
      path.join(pf86, 'Wireshark', 'editcap.exe'),
    ]
  }
  return [
    '/Applications/Wireshark.app/Contents/MacOS/editcap',
    '/usr/local/bin/editcap',
    '/opt/homebrew/bin/editcap',
  ]
}

/**
 * Returns candidate paths for the Wireshark GUI binary.
 */
export function getWiresharkCandidates(): string[] {
  if (isWindows) {
    const pf = process.env.PROGRAMFILES || 'C:\\Program Files'
    const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'
    return [
      path.join(pf, 'Wireshark', 'Wireshark.exe'),
      path.join(pf86, 'Wireshark', 'Wireshark.exe'),
    ]
  }
  return ['/usr/local/bin/wireshark', '/opt/homebrew/bin/wireshark']
}

/**
 * Returns candidate paths for the witr binary.
 */
export function getWitrCandidates(): string[] {
  const home = os.homedir()
  if (isWindows) {
    const gopath = process.env.GOPATH || path.join(home, 'go')
    return [
      path.join(home, 'go', 'bin', 'witr.exe'),
      path.join(gopath, 'bin', 'witr.exe'),
    ]
  }
  return [
    path.join(home, 'go', 'bin', 'witr'),
    '/usr/local/go/bin/witr',
    '/opt/homebrew/bin/witr',
    path.join(home, '.local', 'bin', 'witr'),
  ]
}

/**
 * Returns the command name for finding executables in PATH.
 * 'where' on Windows, 'which' on Unix-like systems.
 */
export function whichCommand(): string {
  return isWindows ? 'where' : 'which'
}

/**
 * Checks if the macOS Wireshark.app bundle exists.
 * Returns the path if found, null otherwise.
 */
export function getMacOSAppBundle(): string | null {
  if (isDarwin && fs.existsSync('/Applications/Wireshark.app')) {
    return '/Applications/Wireshark.app'
  }
  return null
}

/**
 * Returns the binary extension for the current platform.
 */
export function binaryExtension(): string {
  return isWindows ? '.exe' : ''
}

/**
 * Terminates a child process in a platform-appropriate way.
 * On Windows, uses taskkill; on Unix, sends SIGTERM.
 */
export function terminateProcess(proc: ChildProcess): void {
  if (!proc.pid) return

  if (isWindows) {
    // Use taskkill to forcefully terminate the process tree
    spawnSync('taskkill', ['/pid', String(proc.pid), '/f', '/t'], {
      timeout: 5000,
    })
  } else {
    proc.kill('SIGTERM')
  }
}

/**
 * Checks if the current platform is Windows.
 */
export function isPlatformWindows(): boolean {
  return isWindows
}

/**
 * Checks if the current platform is macOS (Darwin).
 */
export function isPlatformDarwin(): boolean {
  return isDarwin
}

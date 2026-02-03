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

/**
 * Get process information using PowerShell on Windows.
 * Returns formatted process details similar to witr output.
 */
export function getWindowsProcessInfo(pid: number): Promise<{ output: string } | { error: string }> {
  return new Promise((resolve) => {
    const psCommand = `
$ErrorActionPreference = 'Stop'
try {
  $proc = Get-Process -Id ${pid} -ErrorAction Stop
  $wmiProc = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue

  $output = @()
  $output += "Process Information"
  $output += "==================="
  $output += "Name:           $($proc.ProcessName)"
  $output += "PID:            $($proc.Id)"
  $output += "Path:           $($proc.Path)"
  if ($wmiProc) {
    $output += "Command Line:   $($wmiProc.CommandLine)"
    $output += "Parent PID:     $($wmiProc.ParentProcessId)"
  }
  $output += "Start Time:     $($proc.StartTime)"
  $output += "CPU Time:       $($proc.TotalProcessorTime)"
  $output += "Memory (WS):    $([math]::Round($proc.WorkingSet64 / 1MB, 2)) MB"
  $output += "Memory (PM):    $([math]::Round($proc.PrivateMemorySize64 / 1MB, 2)) MB"
  $output += "Threads:        $($proc.Threads.Count)"
  $output += "Handles:        $($proc.HandleCount)"
  if ($proc.MainWindowTitle) {
    $output += "Window Title:   $($proc.MainWindowTitle)"
  }

  $output -join [Environment]::NewLine
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
`
    const cp = spawnSync('powershell', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-Command', psCommand
    ], {
      encoding: 'utf8',
      timeout: 10000,
    })

    if (cp.status === 0 && cp.stdout) {
      resolve({ output: cp.stdout.trim() || 'No information available for this process.' })
    } else {
      const errorMsg = cp.stderr?.trim() || `PowerShell exited with code ${cp.status}`
      if (errorMsg.includes('Cannot find a process')) {
        resolve({ error: `Process ${pid} not found or has terminated.` })
      } else {
        resolve({ error: errorMsg })
      }
    }
  })
}

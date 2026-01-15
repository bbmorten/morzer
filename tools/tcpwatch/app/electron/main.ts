import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import readline from 'node:readline'

type StartOptions = {
  intervalMs: number
  stateCsv?: string
  pid?: number
  port?: number
  proc?: string
  includeListen: boolean
}

type Snapshot = {
  updated: string
  title?: string
  rows: Array<{
    Proto: string
    Local: string
    Remote: string
    State: string
    PID: number
    Process: string
  }>
}

let mainWindow: BrowserWindow | null = null
let child: ChildProcessWithoutNullStreams | null = null

function createWindow() {
  const preloadPath = path.join(app.getAppPath(), 'electron/preload.cjs')
  console.log('[main] appPath:', app.getAppPath())
  console.log('[main] preload:', preloadPath, 'exists=', fs.existsSync(preloadPath))

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    backgroundColor: '#0b0d10',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath
    }
  })

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const lvl = ['LOG', 'WARN', 'ERROR', 'DEBUG'][level] ?? String(level)
    console.log(`[renderer:${lvl}] ${message} (${sourceId}:${line})`)
  })

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[renderer] did-fail-load', { errorCode, errorDescription, validatedURL })
  })

  mainWindow.webContents.on('dom-ready', () => {
    console.log('[renderer] dom-ready', { url: mainWindow?.webContents.getURL() })
  })

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[renderer] did-finish-load', { url: mainWindow?.webContents.getURL() })
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[renderer] render-process-gone', details)
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    console.log('[main] devUrl:', devUrl)
    mainWindow.loadURL(devUrl)
  } else {
    const indexPath = path.join(app.getAppPath(), 'renderer-dist/index.html')
    console.log('[main] indexPath:', indexPath, 'exists=', fs.existsSync(indexPath))
    mainWindow.loadFile(indexPath)
  }

  if (process.env.OPEN_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function findUp(startDir: string, relPath: string): string | null {
  let dir = startDir
  while (true) {
    const cand = path.join(dir, relPath)
    if (fs.existsSync(cand)) return cand
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function resolveTcpwatchPath(): string {
  const env = process.env.TCPWATCH_BIN
  if (env && fs.existsSync(env)) return env

  if (app.isPackaged) {
    const packaged = path.join(process.resourcesPath, 'tcpwatch')
    if (fs.existsSync(packaged)) return packaged
  }

  // Dev fallback: repo-relative path.
  const appPath = app.getAppPath()
  const found = findUp(appPath, 'tools/tcpwatch/tcpwatch')
  if (found) return found

  // Last resort: sibling to CWD
  const fallback = path.resolve(process.cwd(), '../tcpwatch')
  if (fs.existsSync(fallback)) return fallback

  throw new Error('tcpwatch binary not found. Build it with: cd tools/tcpwatch && go build -o tcpwatch')
}

function stopChild() {
  if (!child) return
  try {
    child.kill('SIGTERM')
  } catch {
    // ignore
  }
  child = null
}

function startChild(opts: StartOptions) {
  stopChild()

  const bin = resolveTcpwatchPath()

  const args: string[] = ['-jsonl', '-interval', `${opts.intervalMs}ms`]
  if (!opts.includeListen) args.push('-listen=false')
  if (opts.stateCsv) args.push('-state', opts.stateCsv)
  if (typeof opts.pid === 'number' && Number.isFinite(opts.pid)) args.push('-pid', String(opts.pid))
  if (typeof opts.port === 'number' && Number.isFinite(opts.port)) args.push('-port', String(opts.port))
  if (opts.proc && opts.proc.trim()) args.push('-proc', opts.proc.trim())

  const proc = spawn(bin, args, {
    stdio: ['pipe', 'pipe', 'pipe']
  })
  // We never write to stdin; close it immediately.
  proc.stdin.end()
  child = proc

  const rl = readline.createInterface({ input: proc.stdout })
  rl.on('line', (line) => {
    if (!line.trim()) return
    try {
      const snap = JSON.parse(line) as Snapshot
      mainWindow?.webContents.send('tcpwatch:snapshot', snap)
    } catch (e) {
      mainWindow?.webContents.send('tcpwatch:error', {
        message: `Failed to parse snapshot JSON: ${(e as Error).message}`
      })
    }
  })

  proc.stderr.on('data', (buf) => {
    mainWindow?.webContents.send('tcpwatch:error', { message: buf.toString('utf8').trim() })
  })

  proc.on('exit', (code, signal) => {
    if (child === proc) child = null
    rl.close()
    if (code !== 0) {
      mainWindow?.webContents.send('tcpwatch:error', { message: `tcpwatch exited (code=${code}, signal=${signal ?? 'none'})` })
    }
    mainWindow?.webContents.send('tcpwatch:stopped', {})
  })
}

async function runSnapshot(opts: StartOptions): Promise<Snapshot> {
  const bin = resolveTcpwatchPath()
  const intervalMs = Math.max(100, Number.isFinite(opts.intervalMs) ? opts.intervalMs : 500)
  const args: string[] = ['-jsonl', '-once', '-interval', `${intervalMs}ms`]
  if (!opts.includeListen) args.push('-listen=false')
  if (opts.stateCsv) args.push('-state', opts.stateCsv)
  if (typeof opts.pid === 'number' && Number.isFinite(opts.pid)) args.push('-pid', String(opts.pid))
  if (typeof opts.port === 'number' && Number.isFinite(opts.port)) args.push('-port', String(opts.port))
  if (opts.proc && opts.proc.trim()) args.push('-proc', opts.proc.trim())

  return await new Promise<Snapshot>((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    proc.stdin.end()

    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (buf) => (stdout += buf.toString('utf8')))
    proc.stderr.on('data', (buf) => (stderr += buf.toString('utf8')))

    proc.on('error', (err) => reject(err))
    proc.on('close', (code, signal) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `tcpwatch snapshot failed (code=${code}, signal=${signal ?? 'none'})`))
        return
      }

      const line = stdout.trim().split(/\r?\n/).filter(Boolean)[0]
      if (!line) {
        reject(new Error('tcpwatch snapshot produced no output'))
        return
      }
      try {
        resolve(JSON.parse(line) as Snapshot)
      } catch (e) {
        reject(new Error(`failed to parse snapshot JSON: ${(e as Error).message}`))
      }
    })
  })
}

app.whenReady().then(() => {
  createWindow()

  ipcMain.handle('tcpwatch:start', async (_evt, opts: StartOptions) => {
    startChild(opts)
  })

  ipcMain.handle('tcpwatch:stop', async () => {
    stopChild()
  })

  ipcMain.handle('tcpwatch:isRunning', async () => Boolean(child))

  ipcMain.handle('tcpwatch:snapshot', async (_evt, opts: StartOptions) => {
    return await runSnapshot(opts)
  })

  ipcMain.handle('tcpwatch:killProcess', async (_evt, pid: unknown) => {
    const parsed = typeof pid === 'number' ? pid : Number(pid)
    const targetPid = Math.trunc(parsed)
    if (!Number.isFinite(targetPid) || targetPid <= 1) {
      throw new Error(`Invalid PID: ${String(pid)}`)
    }

    const forbidden = new Set<number>([process.pid])
    if (child?.pid) forbidden.add(child.pid)
    const rendererPid = mainWindow?.webContents.getOSProcessId()
    if (typeof rendererPid === 'number') forbidden.add(rendererPid)

    if (forbidden.has(targetPid)) {
      throw new Error(`Refusing to terminate protected PID ${targetPid}`)
    }

    // Check existence/permission.
    try {
      process.kill(targetPid, 0)
    } catch (e) {
      const err = e as NodeJS.ErrnoException
      if (err.code === 'ESRCH') throw new Error(`PID ${targetPid} does not exist`)
      if (err.code === 'EPERM') throw new Error(`Permission denied to signal PID ${targetPid}`)
      throw new Error(`Failed to check PID ${targetPid}: ${err.message}`)
    }

    try {
      process.kill(targetPid, 'SIGTERM')
    } catch (e) {
      const err = e as NodeJS.ErrnoException
      if (err.code === 'EPERM') throw new Error(`Permission denied to terminate PID ${targetPid}`)
      throw new Error(`Failed to terminate PID ${targetPid}: ${err.message}`)
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopChild()
  if (process.platform !== 'darwin') app.quit()
})

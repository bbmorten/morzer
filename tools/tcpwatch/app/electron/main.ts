import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { spawn, spawnSync, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process'
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

type CaptureInterface = { id: string; name: string; description?: string }
type CaptureStatus = {
  running: boolean
  dumpDir?: string
  filePath?: string
  ifaceId?: string
  startedAt?: string
  durationSeconds?: number
  splitting?: boolean
  splitDir?: string
}

let captureChild: ChildProcess | null = null
let captureStatus: CaptureStatus = { running: false }

function sendCaptureStatus(partial?: Partial<CaptureStatus>) {
  captureStatus = { ...captureStatus, ...(partial ?? {}) }
  mainWindow?.webContents.send('tcpwatch:captureStatus', captureStatus)
}

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

function resolveTsharkPath(): string {
  const env = process.env.TSHARK_BIN
  if (env && fs.existsSync(env)) return env

  const candidates = [
    '/Applications/Wireshark.app/Contents/MacOS/tshark',
    '/usr/local/bin/tshark',
    '/opt/homebrew/bin/tshark'
  ]
  for (const cand of candidates) {
    if (fs.existsSync(cand)) return cand
  }

  const which = spawnSync('which', ['tshark'], { encoding: 'utf8' })
  if (which.status === 0) {
    const p = (which.stdout ?? '').trim()
    if (p && fs.existsSync(p)) return p
  }

  throw new Error('tshark not found. Install Wireshark (includes tshark) or set TSHARK_BIN=/abs/path/to/tshark')
}

async function listCaptureInterfaces(): Promise<CaptureInterface[]> {
  const tshark = resolveTsharkPath()
  return await new Promise<CaptureInterface[]>((resolve, reject) => {
    const proc = spawn(tshark, ['-D'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    proc.stdout.on('data', (b) => (out += b.toString('utf8')))
    proc.stderr.on('data', (b) => (err += b.toString('utf8')))
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(err.trim() || `tshark -D failed (code=${code})`))
        return
      }

      const ifaces: CaptureInterface[] = []
      for (const line of out.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed) continue
        // Example: "1. en0 (Wi-Fi)"
        const m = trimmed.match(/^(\d+)\.\s+([^\s]+)\s*(?:\((.*)\))?$/)
        if (!m) continue
        const id = m[1]
        const name = m[2]
        const description = m[3]
        ifaces.push({ id, name, description })
      }
      resolve(ifaces)
    })
  })
}

function stopCaptureChild() {
  if (!captureChild) return
  try {
    captureChild.kill('SIGTERM')
  } catch {
    // ignore
  }
}

async function splitCaptureByTcpStream(captureFile: string, dumpDir: string) {
  const tshark = resolveTsharkPath()
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  const splitDir = path.join(dumpDir, `tcpwatch-split-${ts}`)
  fs.mkdirSync(splitDir, { recursive: true })

  sendCaptureStatus({ splitting: true, splitDir })
  mainWindow?.webContents.send('tcpwatch:captureSplitStart', { captureFile, splitDir })

  const streamIds = await new Promise<number[]>((resolve, reject) => {
    const proc = spawn(tshark, ['-r', captureFile, '-T', 'fields', '-e', 'tcp.stream', '-Y', 'tcp'], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let out = ''
    let err = ''
    proc.stdout.on('data', (b) => (out += b.toString('utf8')))
    proc.stderr.on('data', (b) => (err += b.toString('utf8')))
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(err.trim() || `tshark stream listing failed (code=${code})`))
        return
      }
      const set = new Set<number>()
      for (const line of out.split(/\r?\n/)) {
        const t = line.trim()
        if (!t) continue
        const n = Number(t)
        if (Number.isFinite(n)) set.add(n)
      }
      resolve(Array.from(set).sort((a, b) => a - b))
    })
  })

  const index: {
    captureFile: string
    splitDir: string
    createdAt: string
    streams: Array<{ id: number; file: string }>
  } = {
    captureFile,
    splitDir,
    createdAt: new Date().toISOString(),
    streams: []
  }

  const total = streamIds.length
  for (let i = 0; i < total; i++) {
    const id = streamIds[i]
    const fileName = `tcp-stream-${String(id).padStart(5, '0')}.pcapng`
    const outFile = path.join(splitDir, fileName)

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(tshark, ['-r', captureFile, '-Y', `tcp.stream==${id}`, '-w', outFile], {
        stdio: ['ignore', 'ignore', 'pipe']
      })
      let err = ''
      proc.stderr.on('data', (b) => (err += b.toString('utf8')))
      proc.on('error', reject)
      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(err.trim() || `tshark split failed for tcp.stream=${id} (code=${code})`))
          return
        }
        resolve()
      })
    })

    index.streams.push({ id, file: fileName })
    mainWindow?.webContents.send('tcpwatch:captureSplitProgress', {
      current: i + 1,
      total,
      streamId: id,
      file: fileName
    })
  }

  fs.writeFileSync(path.join(splitDir, 'index.json'), JSON.stringify(index, null, 2), 'utf8')
  mainWindow?.webContents.send('tcpwatch:captureSplitDone', { splitDir, totalStreams: total })
  sendCaptureStatus({ splitting: false })
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

  ipcMain.handle('tcpwatch:selectDumpFolder', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Choose capture output folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled) return null
    const p = res.filePaths?.[0]
    return p ?? null
  })

  ipcMain.handle('tcpwatch:listCaptureInterfaces', async () => {
    return await listCaptureInterfaces()
  })

  ipcMain.handle(
    'tcpwatch:startCapture',
    async (_evt, opts: { dumpDir: string; ifaceId: string; durationSeconds: number }) => {
      if (captureChild) throw new Error('Capture already running')

      const tshark = resolveTsharkPath()
      if (!opts.dumpDir || !fs.existsSync(opts.dumpDir)) throw new Error('Dump folder does not exist')

      const durationSeconds = Math.max(1, Math.min(300, Math.trunc(Number(opts.durationSeconds))))
      const ifaceId = String(opts.ifaceId)
      if (!ifaceId.trim()) throw new Error('Capture interface is required')

      const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
      const filePath = path.join(opts.dumpDir, `tcpwatch-capture-${ts}.pcapng`)

      const args = ['-i', ifaceId, '-n', '-f', 'tcp', '-a', `duration:${durationSeconds}`, '-w', filePath]
      const proc = spawn(tshark, args, { stdio: ['ignore', 'ignore', 'pipe'] })
      captureChild = proc

      sendCaptureStatus({
        running: true,
        dumpDir: opts.dumpDir,
        filePath,
        ifaceId,
        durationSeconds,
        startedAt: new Date().toISOString(),
        splitting: false,
        splitDir: undefined
      })

      proc.stderr.on('data', (buf) => {
        const msg = buf.toString('utf8').trim()
        if (msg) mainWindow?.webContents.send('tcpwatch:captureLog', { message: msg })
      })

      proc.on('exit', async (code, signal) => {
        if (captureChild === proc) captureChild = null
        sendCaptureStatus({ running: false })
        mainWindow?.webContents.send('tcpwatch:captureStopped', { code, signal })

        // Only attempt split if a capture file exists.
        try {
          if (captureStatus.filePath && fs.existsSync(captureStatus.filePath) && captureStatus.dumpDir) {
            await splitCaptureByTcpStream(captureStatus.filePath, captureStatus.dumpDir)
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          mainWindow?.webContents.send('tcpwatch:error', { message: `Capture split failed: ${msg}` })
          sendCaptureStatus({ splitting: false })
        }

        if (code !== 0) {
          mainWindow?.webContents.send('tcpwatch:error', {
            message: `tshark exited (code=${code}, signal=${signal ?? 'none'}). You may need admin privileges or capture permissions.`
          })
        }
      })

      return captureStatus
    }
  )

  ipcMain.handle('tcpwatch:stopCapture', async () => {
    if (!captureChild) return
    stopCaptureChild()
  })

  ipcMain.handle('tcpwatch:getCaptureStatus', async () => captureStatus)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopChild()
  if (process.platform !== 'darwin') app.quit()
})

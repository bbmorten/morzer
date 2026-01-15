import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { spawn, spawnSync, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process'
import readline from 'node:readline'
import { reverse as dnsReverse, lookupService as dnsLookupService } from 'node:dns/promises'

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
  port?: number
  splitting?: boolean
  splitDir?: string
}

let captureChild: ChildProcess | null = null
let captureStatus: CaptureStatus = { running: false }

type StreamEndpoint = {
  ip?: string
  port?: number
  hostnames?: string[]
}

type StreamMeta = {
  src?: StreamEndpoint
  dst?: StreamEndpoint
  description?: string
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (true) {
      const idx = nextIndex
      nextIndex++
      if (idx >= items.length) return
      results[idx] = await fn(items[idx])
    }
  })

  await Promise.all(workers)
  return results
}

function pickBestHostname(names: string[] | undefined): string | undefined {
  const n = (names ?? []).find((s) => s && s.trim())
  return n ? n.trim() : undefined
}

function formatEndpoint(ep: StreamEndpoint | undefined): string {
  if (!ep?.ip) return ''
  const host = pickBestHostname(ep.hostnames)
  const addr = host && host !== ep.ip ? `${host} (${ep.ip})` : ep.ip
  const port = typeof ep.port === 'number' ? `:${ep.port}` : ''
  return `${addr}${port}`
}

async function resolveHostnamesForStreamMeta(metaByStream: Map<number, StreamMeta>) {
  const enableRdns = process.env.TCPWATCH_RDNS !== '0'
  if (!enableRdns) return

  const timeoutEnv = Number(process.env.TCPWATCH_RDNS_TIMEOUT_MS)
  const rdnsTimeoutMs = Number.isFinite(timeoutEnv) ? Math.max(200, Math.min(10000, Math.trunc(timeoutEnv))) : 2000

  const concEnv = Number(process.env.TCPWATCH_RDNS_CONCURRENCY)
  const rdnsConcurrency = Number.isFinite(concEnv) ? Math.max(1, Math.min(32, Math.trunc(concEnv))) : 8

  const ipSet = new Set<string>()
  for (const m of metaByStream.values()) {
    if (m.src?.ip) ipSet.add(m.src.ip)
    if (m.dst?.ip) ipSet.add(m.dst.ip)
  }

  const ips = Array.from(ipSet)
  const cache = new Map<string, string[]>()
  await mapWithConcurrency(ips, rdnsConcurrency, async (ip) => {
    try {
      // 1) Try PTR (reverse DNS)
      const names = await withTimeout(dnsReverse(ip), rdnsTimeoutMs, `reverse DNS for ${ip}`).catch(() => [])
      if (Array.isArray(names) && names.length) {
        cache.set(ip, names)
        return null
      }

      // 2) Fallback: system resolver / getnameinfo (can use mDNS/Bonjour on macOS)
      // Port is required by API; use 0 because we only care about the hostname.
      const res = await withTimeout(dnsLookupService(ip, 0), rdnsTimeoutMs, `lookupService for ${ip}`).catch(() => null)
      const host = res && typeof (res as { hostname?: unknown }).hostname === 'string' ? (res as { hostname: string }).hostname : ''
      if (host && host.trim() && host.trim() !== ip) {
        cache.set(ip, [host.trim()])
      }
    } catch {
      // best effort
    }
    return null
  })

  for (const m of metaByStream.values()) {
    if (m.src?.ip && cache.has(m.src.ip)) m.src.hostnames = cache.get(m.src.ip)
    if (m.dst?.ip && cache.has(m.dst.ip)) m.dst.hostnames = cache.get(m.dst.ip)
  }
}

async function buildSplitIndexFromStreamsDir(splitDir: string) {
  const tshark = resolveTsharkPath()

  const entries = fs.readdirSync(splitDir, { withFileTypes: true })
  const streamFiles = entries
    .filter((e) => e.isFile() && /^tcp-stream-\d{5}\.(pcap|pcapng)$/i.test(e.name))
    .map((e) => e.name)

  if (streamFiles.length === 0) throw new Error(`No tcp-stream-*.pcapng files found in ${splitDir}`)

  const streams = streamFiles
    .map((name) => {
      const m = name.match(/^tcp-stream-(\d{5})\.(pcap|pcapng)$/i)
      const id = m ? Number(m[1]) : NaN
      return { id, file: name }
    })
    .filter((s) => Number.isFinite(s.id))
    .sort((a, b) => a.id - b.id)

  const metaByStream = new Map<number, StreamMeta>()

  // Load endpoints by scanning the first TCP packet from each per-stream file.
  await mapWithConcurrency(streams, 6, async (s) => {
    const filePath = path.join(splitDir, s.file)
    const out = await new Promise<string>((resolve, reject) => {
      const args = [
        '-r',
        filePath,
        '-Y',
        'tcp',
        '-c',
        '1',
        '-T',
        'fields',
        '-E',
        'separator=\t',
        '-E',
        'occurrence=f',
        '-e',
        'ip.src',
        '-e',
        'ipv6.src',
        '-e',
        'tcp.srcport',
        '-e',
        'ip.dst',
        '-e',
        'ipv6.dst',
        '-e',
        'tcp.dstport'
      ]
      const proc = spawn(tshark, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      proc.stdout.on('data', (b) => (stdout += b.toString('utf8')))
      proc.stderr.on('data', (b) => (stderr += b.toString('utf8')))
      proc.on('error', reject)
      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `tshark endpoint scan failed for ${filePath} (code=${code})`))
          return
        }
        resolve(stdout)
      })
    }).catch(() => '')

    const line = out.trim().split(/\r?\n/).filter(Boolean)[0] ?? ''
    if (!line) return null
    const [ip4src, ip6src, srcPortStr, ip4dst, ip6dst, dstPortStr] = line.split('\t')
    const srcIp = (ip4src || ip6src || '').trim()
    const dstIp = (ip4dst || ip6dst || '').trim()
    const srcPort = Math.trunc(Number(srcPortStr))
    const dstPort = Math.trunc(Number(dstPortStr))

    const m: StreamMeta = {}
    if (srcIp) m.src = { ip: srcIp, port: Number.isFinite(srcPort) ? srcPort : undefined }
    if (dstIp) m.dst = { ip: dstIp, port: Number.isFinite(dstPort) ? dstPort : undefined }
    metaByStream.set(s.id, m)
    return null
  })

  await resolveHostnamesForStreamMeta(metaByStream)

  for (const m of metaByStream.values()) {
    const left = formatEndpoint(m.src)
    const right = formatEndpoint(m.dst)
    if (left && right) m.description = `${left} → ${right}`
  }

  const index = {
    version: 2,
    captureFile: '(imported)',
    splitDir,
    createdAt: new Date().toISOString(),
    streams: streams.map((s) => {
      const m = metaByStream.get(s.id)
      return {
        id: s.id,
        file: s.file,
        src: m?.src,
        dst: m?.dst,
        description: m?.description
      }
    })
  }

  const indexPath = path.join(splitDir, 'index.json')
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8')
  return { index, indexPath }
}

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

type WiresharkLauncher =
  | { kind: 'open'; app: string }
  | { kind: 'exec'; path: string }
  | null

function resolveWiresharkLauncher(): WiresharkLauncher {
  const env = process.env.WIRESHARK_BIN
  if (env && fs.existsSync(env)) {
    // Allow either a .app bundle path or an executable.
    if (env.endsWith('.app')) return { kind: 'open', app: env }
    return { kind: 'exec', path: env }
  }

  const appBundle = '/Applications/Wireshark.app'
  if (fs.existsSync(appBundle)) return { kind: 'open', app: appBundle }

  const candidates = ['/usr/local/bin/wireshark', '/opt/homebrew/bin/wireshark']
  for (const cand of candidates) {
    if (fs.existsSync(cand)) return { kind: 'exec', path: cand }
  }

  const which = spawnSync('which', ['wireshark'], { encoding: 'utf8' })
  if (which.status === 0) {
    const p = (which.stdout ?? '').trim()
    if (p && fs.existsSync(p)) return { kind: 'exec', path: p }
  }

  return null
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

  async function loadStreamEndpoints(): Promise<Map<number, StreamMeta>> {
    // Get one packet row per stream-ish (we take the first we see for each stream).
    // Supports both IPv4 and IPv6 by probing ip.* and ipv6.* fields.
    const meta = new Map<number, StreamMeta>()
    const out = await new Promise<string>((resolve, reject) => {
      const args = [
        '-r',
        captureFile,
        '-Y',
        'tcp',
        '-T',
        'fields',
        '-E',
        'separator=\t',
        '-E',
        'occurrence=f',
        '-e',
        'tcp.stream',
        '-e',
        'ip.src',
        '-e',
        'ipv6.src',
        '-e',
        'tcp.srcport',
        '-e',
        'ip.dst',
        '-e',
        'ipv6.dst',
        '-e',
        'tcp.dstport'
      ]
      const proc = spawn(tshark, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      proc.stdout.on('data', (b) => (stdout += b.toString('utf8')))
      proc.stderr.on('data', (b) => (stderr += b.toString('utf8')))
      proc.on('error', reject)
      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `tshark endpoint scan failed (code=${code})`))
          return
        }
        resolve(stdout)
      })
    })

    for (const line of out.split(/\r?\n/)) {
      if (!line.trim()) continue
      const [streamStr, ip4src, ip6src, srcPortStr, ip4dst, ip6dst, dstPortStr] = line.split('\t')
      const id = Number(streamStr)
      if (!Number.isFinite(id)) continue
      if (meta.has(id)) continue

      const srcIp = (ip4src || ip6src || '').trim()
      const dstIp = (ip4dst || ip6dst || '').trim()
      const srcPort = Math.trunc(Number(srcPortStr))
      const dstPort = Math.trunc(Number(dstPortStr))

      const m: StreamMeta = {}
      if (srcIp) m.src = { ip: srcIp, port: Number.isFinite(srcPort) ? srcPort : undefined }
      if (dstIp) m.dst = { ip: dstIp, port: Number.isFinite(dstPort) ? dstPort : undefined }
      meta.set(id, m)
    }

    return meta
  }

  const metaByStream = await loadStreamEndpoints().catch((e) => {
    const msg = e instanceof Error ? e.message : String(e)
    mainWindow?.webContents.send('tcpwatch:captureLog', { message: `Split metadata scan failed (continuing): ${msg}` })
    return new Map<number, StreamMeta>()
  })

  await resolveHostnamesForStreamMeta(metaByStream)

    for (const m of metaByStream.values()) {
      const left = formatEndpoint(m.src)
      const right = formatEndpoint(m.dst)
      if (left && right) m.description = `${left} → ${right}`
    }

  const index: {
    version: number
    captureFile: string
    splitDir: string
    createdAt: string
    streams: Array<{
      id: number
      file: string
      src?: StreamEndpoint
      dst?: StreamEndpoint
      description?: string
    }>
  } = {
    version: 2,
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

    const m = metaByStream.get(id)
    const left = formatEndpoint(m?.src)
    const right = formatEndpoint(m?.dst)
      const description = left && right ? `${left} → ${right}` : undefined

    index.streams.push({ id, file: fileName, src: m?.src, dst: m?.dst, description })
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

  return { splitDir, indexPath: path.join(splitDir, 'index.json') }
}

function isPcapFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return ext === '.pcap' || ext === '.pcapng'
}

function isLikelySplitFolder(dirPath: string): boolean {
  try {
    const base = path.basename(dirPath)
    if (!base.startsWith('tcpwatch-split-')) return false
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    return entries.some((e) => e.isFile() && /^tcp-stream-\d{5}\.(pcap|pcapng)$/i.test(e.name))
  } catch {
    return false
  }
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
    async (_evt, opts: { dumpDir: string; ifaceId: string; durationSeconds: number; port?: unknown }) => {
      if (captureChild) throw new Error('Capture already running')

      const tshark = resolveTsharkPath()
      if (!opts.dumpDir || !fs.existsSync(opts.dumpDir)) throw new Error('Dump folder does not exist')

      const durationSeconds = Math.max(1, Math.min(300, Math.trunc(Number(opts.durationSeconds))))
      const ifaceId = String(opts.ifaceId)
      if (!ifaceId.trim()) throw new Error('Capture interface is required')

      let port: number | undefined
      if (opts.port !== undefined && opts.port !== null && String(opts.port).trim() !== '') {
        const parsed = Math.trunc(Number(opts.port))
        if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
          throw new Error(`Invalid port: ${String(opts.port)}`)
        }
        port = parsed
      }

      const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
      const filePath = path.join(opts.dumpDir, `tcpwatch-capture-${ts}.pcapng`)

      const captureFilter = port ? `tcp port ${port}` : 'tcp'
      const args = ['-i', ifaceId, '-n', '-f', captureFilter, '-a', `duration:${durationSeconds}`, '-w', filePath]
      const proc = spawn(tshark, args, { stdio: ['ignore', 'ignore', 'pipe'] })
      captureChild = proc

      sendCaptureStatus({
        running: true,
        dumpDir: opts.dumpDir,
        filePath,
        ifaceId,
        durationSeconds,
        port,
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

  ipcMain.handle('tcpwatch:selectSplitFolder', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Choose split capture folder',
      properties: ['openDirectory']
    })
    if (res.canceled) return null
    const p = res.filePaths?.[0]
    return p ?? null
  })

  ipcMain.handle('tcpwatch:selectCaptureFile', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Choose a capture file (.pcap/.pcapng)',
      properties: ['openFile'],
      filters: [{ name: 'PCAP', extensions: ['pcap', 'pcapng'] }]
    })
    if (res.canceled) return null
    const p = res.filePaths?.[0]
    return p ?? null
  })

  ipcMain.handle('tcpwatch:readSplitIndex', async (_evt, splitDir: unknown) => {
    const input = String(splitDir ?? '').trim()
    if (!input) throw new Error('Split folder or capture file is required')

    if (!fs.existsSync(input)) throw new Error(`Path not found: ${input}`)

    const st = fs.statSync(input)

    // If user selected a capture file, auto-split it and return the generated index.
    if (st.isFile() && isPcapFile(input)) {
      const dumpDir = path.dirname(input)
      const res = await splitCaptureByTcpStream(input, dumpDir)
      const raw = fs.readFileSync(res.indexPath, 'utf8')
      return JSON.parse(raw) as unknown
    }

    // Directory: either contains index.json, is a split folder missing index.json, or is a dump root.
    const dir = st.isDirectory() ? input : path.dirname(input)

    const directIndex = path.join(dir, 'index.json')
    let indexPath = directIndex

    if (!fs.existsSync(indexPath)) {
      const sameSplitDir =
        captureStatus.splitting &&
        typeof captureStatus.splitDir === 'string' &&
        path.resolve(captureStatus.splitDir) === path.resolve(dir)
      if (sameSplitDir) {
        throw new Error(`Split is still in progress for ${dir}. Please wait for splitting to finish and try again.`)
      }
    }

    if (!fs.existsSync(indexPath) && isLikelySplitFolder(dir)) {
      // Regenerate missing index.json from tcp-stream-* files.
      mainWindow?.webContents.send('tcpwatch:captureLog', { message: `index.json missing; rebuilding from stream files in ${dir}` })
      await buildSplitIndexFromStreamsDir(dir)
      indexPath = path.join(dir, 'index.json')
    }

    if (!fs.existsSync(indexPath)) {
      // 1) If user picked the dump root, try to find the most recent split folder.
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        const splitCandidates = entries
          .filter((e) => e.isDirectory() && e.name.startsWith('tcpwatch-split-'))
          .map((e) => {
            const splitFolder = path.join(dir, e.name)
            const st = fs.statSync(splitFolder)
            return { splitFolder, mtimeMs: st.mtimeMs }
          })

        splitCandidates.sort((a, b) => b.mtimeMs - a.mtimeMs)

        for (const cand of splitCandidates) {
          const idx = path.join(cand.splitFolder, 'index.json')
          if (fs.existsSync(idx)) {
            indexPath = idx
            break
          }
          if (isLikelySplitFolder(cand.splitFolder)) {
            mainWindow?.webContents.send('tcpwatch:captureLog', {
              message: `index.json missing; rebuilding from stream files in ${cand.splitFolder}`
            })
            await buildSplitIndexFromStreamsDir(cand.splitFolder)
            const rebuilt = path.join(cand.splitFolder, 'index.json')
            if (fs.existsSync(rebuilt)) {
              indexPath = rebuilt
              break
            }
          }
        }
      } catch {
        // ignore
      }
    }

    if (!fs.existsSync(indexPath)) {
      // 2) If this folder has capture files but no index, pick the newest capture and split it.
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        const captures = entries
          .filter((e) => e.isFile() && isPcapFile(e.name))
          .map((e) => {
            const p = path.join(dir, e.name)
            const st = fs.statSync(p)
            return { p, mtimeMs: st.mtimeMs }
          })
        captures.sort((a, b) => b.mtimeMs - a.mtimeMs)
        if (captures[0]) {
          const res = await splitCaptureByTcpStream(captures[0].p, dir)
          indexPath = res.indexPath
        }
      } catch {
        // ignore
      }
    }

    if (!fs.existsSync(indexPath)) throw new Error(`index.json not found (and no capture file to import) in ${dir}`)
    const raw = fs.readFileSync(indexPath, 'utf8')
    return JSON.parse(raw) as unknown
  })

  ipcMain.handle('tcpwatch:openInWireshark', async (_evt, filePath: unknown) => {
    const p = String(filePath ?? '').trim()
    if (!p) throw new Error('File path is required')
    if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`)

    // Prefer explicit Wireshark open.
    const launcher = resolveWiresharkLauncher()
    if (launcher?.kind === 'open') {
      // Use macOS 'open -a' so Wireshark is used even if default app differs.
      const res = spawnSync('open', ['-a', launcher.app, p], { encoding: 'utf8' })
      if (res.status !== 0) {
        const msg = (res.stderr ?? '').trim() || `open failed (code=${res.status})`
        throw new Error(msg)
      }
      return
    }
    if (launcher?.kind === 'exec') {
      const res = spawnSync(launcher.path, [p], { encoding: 'utf8' })
      if (res.status !== 0) {
        const msg = (res.stderr ?? '').trim() || `wireshark failed (code=${res.status})`
        throw new Error(msg)
      }
      return
    }

    // Fallback: open with default associated app.
    const err = await shell.openPath(p)
    if (err) throw new Error(err)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopChild()
  if (process.platform !== 'darwin') app.quit()
})

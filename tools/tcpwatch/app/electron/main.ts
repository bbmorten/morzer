import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { spawn, spawnSync, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process'
import readline from 'node:readline'
import { reverse as dnsReverse, lookupService as dnsLookupService } from 'node:dns/promises'
import dotenv from 'dotenv'
import { Client as McpClient } from '@modelcontextprotocol/sdk/client'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { checkForUpdate, downloadAndInstallUpdate, type UpdateCheckResult } from './updater.js'
import { buildAppMenu } from './menu.js'

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
  captureFilter?: string
  splitting?: boolean
  splitDir?: string
  snapLen?: number
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

function getPcapFileStats(filePath: string): { sizeBytes?: number; packetCount?: number } {
  let sizeBytes: number | undefined
  try {
    const st = fs.statSync(filePath)
    if (st.isFile()) sizeBytes = st.size
  } catch {
    // ignore
  }

  let packetCount: number | undefined
  try {
    const tshark = resolveTsharkPath()
    // io,stat,0 prints a summary table that includes a "Frames"/"Frames:" value depending on version.
    const res = spawnSync(tshark, ['-r', filePath, '-q', '-z', 'io,stat,0'], { encoding: 'utf8', timeout: 30000 })
    if (res.status === 0) {
      const text = String(res.stdout ?? '')
      const m1 = text.match(/\bFrames\s*:\s*(\d+)\b/i)
      const m2 = text.match(/\bFrames\b\s+(\d+)\b/i)
      const raw = m1?.[1] ?? m2?.[1]
      const n = raw !== undefined ? Math.trunc(Number(raw)) : NaN
      if (Number.isFinite(n) && n >= 0) packetCount = n
    }
  } catch {
    // ignore
  }

  return { sizeBytes, packetCount }
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
      const stats = getPcapFileStats(path.join(splitDir, s.file))
      const m = metaByStream.get(s.id)
      return {
        id: s.id,
        file: s.file,
        src: m?.src,
        dst: m?.dst,
        description: m?.description,
        sizeBytes: stats.sizeBytes,
        packetCount: stats.packetCount
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

function resolveRepoRoot(): string {
  const appPath = app.getAppPath()
  const mcpPath = findUp(appPath, '.mcp.json')
  if (mcpPath) return path.dirname(mcpPath)
  const gitPath = findUp(appPath, '.git')
  if (gitPath) return path.dirname(gitPath)
  return appPath
}

let envLoaded = false
function loadRepoEnvOnce() {
  if (envLoaded) return
  envLoaded = true

  const repoRoot = resolveRepoRoot()
  const candidates: string[] = []
  if (app.isPackaged) {
    // Allow end users to configure secrets without needing a repo checkout.
    candidates.push(path.join(app.getPath('userData'), '.env'))
  }
  candidates.push(path.join(repoRoot, '.env'))

  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath })
      break
    }
  }
}

type PacketAnalysisResult = {
  filePath: string
  generatedAt: string
  model?: string
  text: string
}

type DnsExtractIndex = {
  version: number
  sourceFile: string
  extractDir: string
  createdAt: string
  files: Array<{
    file: string
  }>
}

type McpServerConfig = { command: string; args?: string[] }

function resolveMcpcapServerConfig(): McpServerConfig {
  const envBin = process.env.TCPWATCH_MCPCAP_BIN || process.env.MCPCAP_BIN
  if (envBin && fs.existsSync(envBin)) return { command: envBin, args: [] }

  const repoRoot = resolveRepoRoot()
  const candidates: string[] = []
  if (app.isPackaged) {
    // Packaged apps don't have the repo root; allow a user-level config file.
    candidates.push(path.join(app.getPath('userData'), '.mcp.json'))
  }
  candidates.push(path.join(repoRoot, '.mcp.json'))

  const cfgPath = candidates.find((p) => fs.existsSync(p))
  if (!cfgPath) {
    const hint = app.isPackaged
      ? `Create ${path.join(app.getPath('userData'), '.mcp.json')} or set TCPWATCH_MCPCAP_BIN=/abs/path/to/mcpcap`
      : 'Expected .mcp.json at repo root or set TCPWATCH_MCPCAP_BIN=/abs/path/to/mcpcap'
    throw new Error(`mcpcap MCP server not configured. ${hint}`)
  }
  const raw = fs.readFileSync(cfgPath, 'utf8')
  const parsed = JSON.parse(raw) as any
  const server = parsed?.mcpServers?.mcpcap
  const command = String(server?.command ?? '').trim()
  if (!command) throw new Error('Invalid .mcp.json: missing mcpServers.mcpcap.command')
  const args = Array.isArray(server?.args) ? server.args.map((x: any) => String(x)) : []
  return { command, args }
}

function resolvePacketAnalysisPrompt(): string {
  const candidates: string[] = []
  if (app.isPackaged) {
    // Shipped as an external resource so we can read it from the filesystem.
    candidates.push(path.join(process.resourcesPath, 'prompts', 'packet-analysis.md'))
  }

  const repoRoot = resolveRepoRoot()
  candidates.push(path.join(repoRoot, '.github', 'prompts', 'packet-analysis.md'))

  const promptPath = candidates.find((p) => fs.existsSync(p))
  if (!promptPath) throw new Error(`Prompt not found. Tried: ${candidates.join(', ')}`)
  return fs.readFileSync(promptPath, 'utf8')
}

function resolveDnsAnalysisPrompt(): string {
  const candidates: string[] = []
  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, 'prompts', 'dns-analysis.md'))
  }

  const repoRoot = resolveRepoRoot()
  candidates.push(path.join(repoRoot, '.github', 'prompts', 'dns-analysis.md'))

  const promptPath = candidates.find((p) => fs.existsSync(p))
  if (!promptPath) throw new Error(`DNS prompt not found. Tried: ${candidates.join(', ')}`)
  return fs.readFileSync(promptPath, 'utf8')
}

type AnthropicTool = {
  name: string
  description?: string
  input_schema: any
}

type AnthropicMessage = {
  role: 'user' | 'assistant'
  content: any[]
}

function getAnthropicApiKey(): string {
  const key = String(process.env.ANTHROPIC_API_KEY ?? '').trim()
  if (!key) {
    const hint = app.isPackaged
      ? `Create ${path.join(app.getPath('userData'), '.env')} with ANTHROPIC_API_KEY=...`
      : 'Create a .env at repo root with ANTHROPIC_API_KEY=...'
    throw new Error(`Missing ANTHROPIC_API_KEY. ${hint}`)
  }
  return key
}

type AnthropicModelInfo = { id: string; display_name?: string }

let cachedAutoModel: string | null = null

function getConfiguredAnthropicModel(): string | null {
  const m = String(process.env.TCPWATCH_CLAUDE_MODEL ?? process.env.ANTHROPIC_MODEL ?? '').trim()
  return m || null
}

function pickBestModel(models: AnthropicModelInfo[]): string {
  const ids = (models ?? []).map((m) => String(m.id)).filter(Boolean)
  const preferPrefixes = [
    'claude-opus-4-5-',
    'claude-sonnet-4-5-',
    'claude-opus-4-1-',
    'claude-opus-4-',
    'claude-sonnet-4-',
    'claude-haiku-4-5-'
  ]

  for (const p of preferPrefixes) {
    const found = ids.find((id) => id.startsWith(p))
    if (found) return found
  }

  // Fallback: pick any Claude model.
  const anyClaude = ids.find((id) => id.startsWith('claude-'))
  if (anyClaude) return anyClaude
  if (ids[0]) return ids[0]
  throw new Error('No Anthropic models available for this API key.')
}

async function resolveAnthropicModel(): Promise<string> {
  const configured = getConfiguredAnthropicModel()
  if (configured) return configured
  if (cachedAutoModel) return cachedAutoModel

  const apiKey = getAnthropicApiKey()
  const res = await fetch('https://api.anthropic.com/v1/models', {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    }
  })
  const bodyText = await res.text()
  if (!res.ok) throw new Error(`Anthropic API error (${res.status}) while listing models: ${bodyText}`)
  const parsed = JSON.parse(bodyText)
  const models: AnthropicModelInfo[] = Array.isArray(parsed?.data)
    ? parsed.data
    : Array.isArray(parsed?.models)
      ? parsed.models
      : []

  cachedAutoModel = pickBestModel(models)
  return cachedAutoModel
}

async function anthropicMessagesCreate(payload: any): Promise<any> {
  const apiKey = getAnthropicApiKey()
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(payload)
  })
  const bodyText = await res.text()
  if (!res.ok) throw new Error(`Anthropic API error (${res.status}): ${bodyText}`)
  return JSON.parse(bodyText)
}

function extractTextFromAnthropicContent(content: any[]): string {
  const parts: string[] = []
  for (const block of content ?? []) {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n').trim()
}

function coerceMcpToolText(result: any): string {
  if (result?.structuredContent !== undefined) return JSON.stringify(result.structuredContent, null, 2)
  if (Array.isArray(result?.content)) {
    return result.content
      .map((c: any) => (c?.type === 'text' ? String(c.text ?? '') : JSON.stringify(c)))
      .join('\n')
      .trim()
  }
  return JSON.stringify(result ?? {}, null, 2)
}

function tryParseJson(text: string): any {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function callMcpcapTool(mcp: any, toolName: string, filePath: string): Promise<{ raw: string; json: any | null }> {
  // The Python script uses `pcap_file`. Some earlier experiments used `filePath`.
  // Send both to be resilient across mcpcap versions.
  const args = { pcap_file: filePath, filePath }
  const result = await mcp.callTool({ name: toolName, arguments: args })
  const raw = coerceMcpToolText(result)
  const json = tryParseJson(raw)
  return { raw, json }
}

function getTsharkAnalysis(filePath: string): any {
  const tshark = resolveTsharkPath()

  const run = (args: string[]): { ok: boolean; stdout: string; stderr: string } => {
    const res = spawnSync(tshark, args, { encoding: 'utf8', timeout: 30000 })
    return {
      ok: res.status === 0,
      stdout: String(res.stdout ?? ''),
      stderr: String(res.stderr ?? '')
    }
  }

  const out: any = {}

  // TCP conversation statistics
  {
    const r = run(['-r', filePath, '-q', '-z', 'conv,tcp'])
    if (r.ok) out.tcp_conversations = r.stdout
    else out.tcp_conversations_error = r.stderr.trim() || 'tshark conv,tcp failed'
  }

  // Expert info (note)
  {
    const r = run(['-r', filePath, '-q', '-z', 'expert,note'])
    if (r.ok) out.expert_info = r.stdout
    else out.expert_info_error = r.stderr.trim() || 'tshark expert,note failed'
  }

  // IO stats (retransmissions, dup ack, lost segment, zero window)
  {
    const z =
      'io,stat,0,' +
      'COUNT(tcp.analysis.retransmission)tcp.analysis.retransmission,' +
      'COUNT(tcp.analysis.duplicate_ack)tcp.analysis.duplicate_ack,' +
      'COUNT(tcp.analysis.lost_segment)tcp.analysis.lost_segment,' +
      'COUNT(tcp.analysis.zero_window)tcp.analysis.zero_window'
    const r = run(['-r', filePath, '-q', '-z', z])
    if (r.ok) out.tcp_stats = r.stdout
    else out.tcp_stats_error = r.stderr.trim() || 'tshark io,stat failed'
  }

  // RTT stats from tcp.analysis.ack_rtt
  {
    const r = run(['-r', filePath, '-Y', 'tcp.analysis.ack_rtt', '-T', 'fields', '-e', 'tcp.analysis.ack_rtt'])
    if (r.ok && r.stdout.trim()) {
      const vals = r.stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n) && n >= 0)
      if (vals.length) {
        const min = Math.min(...vals)
        const max = Math.max(...vals)
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length
        out.rtt_stats = {
          samples: vals.length,
          min_ms: min * 1000,
          max_ms: max * 1000,
          avg_ms: avg * 1000
        }
      }
    }
  }

  return out
}

function getTsharkDnsAnalysis(filePath: string): any {
  const tshark = resolveTsharkPath()

  const run = (args: string[]): { ok: boolean; stdout: string; stderr: string } => {
    const res = spawnSync(tshark, args, { encoding: 'utf8', timeout: 30000 })
    return {
      ok: res.status === 0,
      stdout: String(res.stdout ?? ''),
      stderr: String(res.stderr ?? '')
    }
  }

  const out: any = {}

  // Basic counts: queries/responses and rcode breakdown (best-effort).
  // This works when tshark can dissect DNS and will naturally include UDP/TCP DNS.
  {
    const z =
      'io,stat,0,' +
      'COUNT(dns)dns,' +
      'COUNT(mdns)mdns,' +
      'COUNT(llmnr)llmnr,' +
      'COUNT(dns.flags.response==0)query,' +
      'COUNT(dns.flags.response==1)response,' +
      'COUNT(dns.flags.rcode==0)rcode_noerror,' +
      'COUNT(dns.flags.rcode==2)rcode_servfail,' +
      'COUNT(dns.flags.rcode==3)rcode_nxdomain'
    const r = run(['-r', filePath, '-q', '-z', z])
    if (r.ok) out.dns_stats = r.stdout
    else out.dns_stats_error = r.stderr.trim() || 'tshark dns io,stat failed'
  }

  // Conversation statistics on UDP/53 can be helpful when the capture contains DNS.
  {
    const r = run(['-r', filePath, '-q', '-z', 'conv,udp'])
    if (r.ok) out.udp_conversations = r.stdout
    else out.udp_conversations_error = r.stderr.trim() || 'tshark conv,udp failed'
  }

  return out
}

async function extractDnsFromCapture(sourceFile: string): Promise<DnsExtractIndex> {
  const tshark = resolveTsharkPath()
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  const baseDir = path.dirname(sourceFile)
  const extractDir = path.join(baseDir, `tcpwatch-dns-${ts}`)
  fs.mkdirSync(extractDir, { recursive: true })

  const outName = 'dns.pcapng'
  const outPath = path.join(extractDir, outName)
  const filter = '(dns || mdns || llmnr)'

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(tshark, ['-r', sourceFile, '-n', '-Y', filter, '-w', outPath], { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    proc.stderr.on('data', (b) => (err += b.toString('utf8')))
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(err.trim() || `tshark DNS extract failed (filter=${filter}, code=${code})`))
        return
      }
      resolve()
    })
  })

  const index: DnsExtractIndex = {
    version: 1,
    sourceFile,
    extractDir,
    createdAt: new Date().toISOString(),
    files: [{ file: outName }]
  }

  fs.writeFileSync(path.join(extractDir, 'index.json'), JSON.stringify(index, null, 2), 'utf8')
  return index
}

async function runDnsAnalysisWithClaude(filePath: string): Promise<PacketAnalysisResult> {
  loadRepoEnvOnce()

  const prompt = resolveDnsAnalysisPrompt()
  const model = await resolveAnthropicModel()

  const mcpcapCfg = resolveMcpcapServerConfig()
  const repoRoot = resolveRepoRoot()

  const mcp = new McpClient({ name: 'tcpwatch', version: '0.1.1' })
  const transport = new StdioClientTransport({
    command: mcpcapCfg.command,
    args: mcpcapCfg.args ?? [],
    cwd: repoRoot,
    stderr: 'pipe'
  })
  await mcp.connect(transport)

  try {
    const capinfos = await callMcpcapTool(mcp, 'analyze_capinfos', filePath)
    const dns = await callMcpcapTool(mcp, 'analyze_dns_packets', filePath)
    const tshark = getTsharkDnsAnalysis(filePath)

    const analysisInput = {
      filePath,
      mcpcap: {
        capinfos: capinfos.json ?? capinfos.raw,
        dns: dns.json ?? dns.raw
      },
      tshark
    }

    const messages: AnthropicMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              `${prompt}\n\n` +
              `You have already been given the outputs of the mcpcap MCP tools and optional tshark stats. ` +
              `Do NOT request or call tools; analyze only the data below and follow the output format.\n\n` +
              `## Analysis Input\n` +
              '```json\n' +
              `${JSON.stringify(analysisInput, null, 2)}\n` +
              '```\n'
          }
        ]
      }
    ]

    const resp = await anthropicMessagesCreate({
      model,
      max_tokens: 2000,
      messages
    })

    const content = resp?.content ?? []
    const finalText = extractTextFromAnthropicContent(content)
    if (!finalText) throw new Error('Claude returned no text output for DNS analysis.')

    return {
      filePath,
      generatedAt: new Date().toISOString(),
      model,
      text: finalText
    }
  } finally {
    try {
      await mcp.close()
    } catch {
      // ignore
    }
  }
}

async function runPacketAnalysisWithClaude(filePath: string): Promise<PacketAnalysisResult> {
  loadRepoEnvOnce()

  const prompt = resolvePacketAnalysisPrompt()
  const model = await resolveAnthropicModel()

  const mcpcapCfg = resolveMcpcapServerConfig()
  const repoRoot = resolveRepoRoot()

  const mcp = new McpClient({ name: 'tcpwatch', version: '0.1.1' })
  const transport = new StdioClientTransport({
    command: mcpcapCfg.command,
    args: mcpcapCfg.args ?? [],
    cwd: repoRoot,
    stderr: 'pipe'
  })
  await mcp.connect(transport)

  try {
    // Mirror the Python workflow: run mcpcap tools deterministically, then send all data to Claude.
    const capinfos = await callMcpcapTool(mcp, 'analyze_capinfos', filePath)
    const dns = await callMcpcapTool(mcp, 'analyze_dns_packets', filePath)
    const dhcp = await callMcpcapTool(mcp, 'analyze_dhcp_packets', filePath)
    const icmp = await callMcpcapTool(mcp, 'analyze_icmp_packets', filePath)

    const tshark = getTsharkAnalysis(filePath)

    const analysisInput = {
      filePath,
      mcpcap: {
        capinfos: capinfos.json ?? capinfos.raw,
        dns: dns.json ?? dns.raw,
        dhcp: dhcp.json ?? dhcp.raw,
        icmp: icmp.json ?? icmp.raw
      },
      tshark
    }

    const messages: AnthropicMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              `${prompt}\n\n` +
              `You have already been given the outputs of the mcpcap MCP tools and optional tshark stats. ` +
              `Do NOT request or call tools; analyze only the data below and follow the output format.\n\n` +
              `## Analysis Input\n` +
              '```json\n' +
              `${JSON.stringify(analysisInput, null, 2)}\n` +
              '```\n'
          }
        ]
      }
    ]

    const resp = await anthropicMessagesCreate({
      model,
      max_tokens: 2000,
      messages
    })

    const content = resp?.content ?? []
    const finalText = extractTextFromAnthropicContent(content)
    if (!finalText) throw new Error('Claude returned no text output for analysis.')

    return {
      filePath,
      generatedAt: new Date().toISOString(),
      model,
      text: finalText
    }
  } finally {
    try {
      await mcp.close()
    } catch {
      // ignore
    }
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

function resolveEditcapPath(): string {
  const env = process.env.EDITCAP_BIN
  if (env && fs.existsSync(env)) return env

  const candidates = [
    '/Applications/Wireshark.app/Contents/MacOS/editcap',
    '/usr/local/bin/editcap',
    '/opt/homebrew/bin/editcap'
  ]
  for (const cand of candidates) {
    if (fs.existsSync(cand)) return cand
  }

  const which = spawnSync('which', ['editcap'], { encoding: 'utf8' })
  if (which.status === 0) {
    const p = (which.stdout ?? '').trim()
    if (p && fs.existsSync(p)) return p
  }

  throw new Error('editcap not found. Install Wireshark (includes editcap) or set EDITCAP_BIN=/abs/path/to/editcap')
}

function normalizeSnapLen(raw: unknown, fallback: number): number {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback
  const n = Math.trunc(Number(raw))
  if (!Number.isFinite(n)) return fallback
  // 0 disables truncation.
  if (n <= 0) return 0
  // Keep within reasonable bounds.
  return Math.max(64, Math.min(262144, n))
}

function applySnapLenToFile(inputFile: string, outputFile: string, snapLen: number): { applied: boolean; message?: string } {
  if (snapLen <= 0) return { applied: false }

  let editcap: string
  try {
    editcap = resolveEditcapPath()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { applied: false, message: msg }
  }

  const tmp = `${outputFile}.snap.tmp`
  try {
    if (fs.existsSync(tmp)) fs.rmSync(tmp)
  } catch {
    // ignore
  }

  const res = spawnSync(editcap, ['-s', String(snapLen), inputFile, tmp], { encoding: 'utf8' })
  if (res.status !== 0) {
    const msg = (res.stderr ?? '').trim() || `editcap failed (code=${res.status})`
    try {
      if (fs.existsSync(tmp)) fs.rmSync(tmp)
    } catch {
      // ignore
    }
    return { applied: false, message: msg }
  }

  fs.renameSync(tmp, outputFile)
  return { applied: true }
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

async function splitCaptureByTcpStream(captureFile: string, dumpDir: string, snapLen?: number) {
  const tshark = resolveTsharkPath()
  const effectiveSnapLen = normalizeSnapLen(snapLen, 200)
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  const splitDir = path.join(dumpDir, `tcpwatch-split-${ts}`)
  fs.mkdirSync(splitDir, { recursive: true })

  sendCaptureStatus({ splitting: true, splitDir, snapLen: effectiveSnapLen })
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
      sizeBytes?: number
      packetCount?: number
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
    const tmpFile = `${outFile}.tmp`

    try {
      if (fs.existsSync(tmpFile)) fs.rmSync(tmpFile)
    } catch {
      // ignore
    }

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(tshark, ['-r', captureFile, '-Y', `tcp.stream==${id}`, '-w', tmpFile], {
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

    // Apply snaplen truncation to per-stream output, if enabled.
    const snapRes = applySnapLenToFile(tmpFile, outFile, effectiveSnapLen)
    if (!snapRes.applied) {
      // If we couldn't apply snaplen (missing editcap or error), keep the original stream file.
      try {
        fs.renameSync(tmpFile, outFile)
      } catch {
        // ignore
      }
      if (snapRes.message) {
        mainWindow?.webContents.send('tcpwatch:captureLog', {
          message: `Snaplen not applied (snapLen=${effectiveSnapLen}) for ${fileName}: ${snapRes.message}`
        })
      }
    } else {
      try {
        if (fs.existsSync(tmpFile)) fs.rmSync(tmpFile)
      } catch {
        // ignore
      }
    }

    const m = metaByStream.get(id)
    const left = formatEndpoint(m?.src)
    const right = formatEndpoint(m?.dst)
      const description = left && right ? `${left} → ${right}` : undefined

    const stats = getPcapFileStats(outFile)
    index.streams.push({
      id,
      file: fileName,
      src: m?.src,
      dst: m?.dst,
      description,
      sizeBytes: stats.sizeBytes,
      packetCount: stats.packetCount
    })
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

type ExpertInfoItem = {
  frameNumber: number
  timeEpoch?: number
  severity: string
  group?: string
  protocol?: string
  message: string
}

type ExpertInfoResult = {
  filePath: string
  generatedAt: string
  total: number
  countsBySeverity: Record<string, number>
  summaryText?: string
  items: ExpertInfoItem[]
}

function deriveProtocolFromFrameProtocols(raw: string): string | undefined {
  const s = String(raw ?? '').trim()
  if (!s) return undefined
  const parts = s.split(':').map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return undefined
  // Prefer "tcp" when present, otherwise use the innermost dissector.
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i] === 'tcp') return 'tcp'
  }
  return parts[parts.length - 1]
}

function keywordAlias(s: string): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function normalizeExpertSeverityKeyword(raw: string): string {
  const v = String(raw ?? '').trim()
  const lower = v.toLowerCase()
  if (lower === 'warning') return 'warn'
  if (lower === 'chat' || lower === 'note' || lower === 'warn' || lower === 'error') return lower
  const k = keywordAlias(v)
  return k || 'unknown'
}

function normalizeExpertGroupKeyword(raw: string): string {
  const k = keywordAlias(raw)
  return k || 'unknown'
}

function splitAgg(value: string, agg: string): string[] {
  const s = String(value ?? '').trim()
  if (!s) return []
  return s
    .split(agg)
    .map((x) => x.trim())
    .filter(Boolean)
}

async function readExpertInfo(filePath: string): Promise<ExpertInfoResult> {
  const tshark = resolveTsharkPath()
  const agg = '\u001f'

  // 1) Collect per-frame metadata (time + protocol) for frames that have expert info.
  const frameMeta = new Map<number, { timeEpoch?: number; protocol?: string }>()
  const metaOut = await new Promise<string>((resolve, reject) => {
    const args = [
      '-r',
      filePath,
      '-n',
      '-Y',
      '_ws.expert.message',
      '-T',
      'fields',
      '-E',
      'separator=\t',
      '-E',
      'occurrence=f',
      '-e',
      'frame.number',
      '-e',
      'frame.time_epoch',
      '-e',
      'frame.protocols'
    ]
    const proc = spawn(tshark, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    proc.stdout.on('data', (b) => (out += b.toString('utf8')))
    proc.stderr.on('data', (b) => (err += b.toString('utf8')))
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(err.trim() || `tshark expert meta scan failed (code=${code})`))
        return
      }
      resolve(out)
    })
  }).catch((e) => {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`Failed to extract expert info (tshark meta): ${msg}`)
  })

  for (const line of metaOut.split(/\r?\n/)) {
    const t = line.trimEnd()
    if (!t) continue
    const [frameStr, timeStr, protosStr] = t.split('\t')
    const frameNumber = Math.trunc(Number(frameStr))
    if (!Number.isFinite(frameNumber) || frameNumber <= 0) continue
    const timeEpoch = Number(timeStr)
    const protocol = deriveProtocolFromFrameProtocols(protosStr)
    frameMeta.set(frameNumber, {
      timeEpoch: Number.isFinite(timeEpoch) ? timeEpoch : undefined,
      protocol
    })
  }

  // 2) Extract expert items with keyword aliases by parsing tshark verbose output.
  // This avoids brittle numeric ID mappings for _ws.expert.severity/group (which are bitmasks in some versions).
  const verboseOut = await new Promise<string>((resolve, reject) => {
    const args = ['-r', filePath, '-n', '-Y', '_ws.expert.message', '-V']
    const proc = spawn(tshark, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    proc.stdout.on('data', (b) => (out += b.toString('utf8')))
    proc.stderr.on('data', (b) => (err += b.toString('utf8')))
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(err.trim() || `tshark expert verbose scan failed (code=${code})`))
        return
      }
      resolve(out)
    })
  }).catch((e) => {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`Failed to extract expert info (tshark): ${msg}`)
  })

  const items: ExpertInfoItem[] = []
  const countsBySeverity: Record<string, number> = {}

  let currentFrameNumber: number | null = null
  let collecting: string | null = null

  const lines = verboseOut.split(/\r?\n/)
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/g, '')
    const mFrame = line.match(/^Frame\s+(\d+):\s+/)
    if (mFrame) {
      const n = Math.trunc(Number(mFrame[1]))
      currentFrameNumber = Number.isFinite(n) ? n : null
      continue
    }

    if (collecting) {
      collecting += ' ' + line.trim()
      if (collecting.includes(']')) {
        const full = collecting
        collecting = null

        const parsed = full.match(/\[Expert Info \(([^)]+)\):\s*(.*)\]$/)
        if (!parsed) continue
        const sevGroup = parsed[1]
        const msg = (parsed[2] ?? '').trim()
        const parts = sevGroup.split('/').map((x) => x.trim()).filter(Boolean)
        const sevLabel = parts[0] ?? ''
        const groupLabel = parts[1] ?? ''
        const severity = normalizeExpertSeverityKeyword(sevLabel)
        const group = groupLabel ? normalizeExpertGroupKeyword(groupLabel) : undefined

        const meta = currentFrameNumber ? frameMeta.get(currentFrameNumber) : undefined
        const it: ExpertInfoItem = {
          frameNumber: currentFrameNumber ?? 0,
          timeEpoch: meta?.timeEpoch,
          severity,
          group,
          protocol: meta?.protocol,
          message: msg
        }
        items.push(it)
        countsBySeverity[severity] = (countsBySeverity[severity] ?? 0) + 1
      }
      continue
    }

    const idx = line.indexOf('[Expert Info (')
    if (idx >= 0) {
      const start = line.slice(idx).trim()
      if (start.includes(']')) {
        collecting = start
        // Immediately finalize this one-line entry.
        const full = collecting
        collecting = null

        const parsed = full.match(/\[Expert Info \(([^)]+)\):\s*(.*)\]$/)
        if (!parsed) continue
        const sevGroup = parsed[1]
        const msg = (parsed[2] ?? '').trim()
        const parts = sevGroup.split('/').map((x) => x.trim()).filter(Boolean)
        const sevLabel = parts[0] ?? ''
        const groupLabel = parts[1] ?? ''
        const severity = normalizeExpertSeverityKeyword(sevLabel)
        const group = groupLabel ? normalizeExpertGroupKeyword(groupLabel) : undefined

        const meta = currentFrameNumber ? frameMeta.get(currentFrameNumber) : undefined
        const it: ExpertInfoItem = {
          frameNumber: currentFrameNumber ?? 0,
          timeEpoch: meta?.timeEpoch,
          severity,
          group,
          protocol: meta?.protocol,
          message: msg
        }
        items.push(it)
        countsBySeverity[severity] = (countsBySeverity[severity] ?? 0) + 1
        continue
      }
      collecting = start
      continue
    }
  }

  // Keep results stable for display.
  items.sort((a, b) => (a.frameNumber - b.frameNumber) || a.message.localeCompare(b.message))

  // Best-effort expert summary (like tshark -z expert). Kept as raw text.
  let summaryText: string | undefined
  try {
    summaryText = await new Promise<string>((resolve, reject) => {
      const proc = spawn(tshark, ['-r', filePath, '-q', '-z', 'expert'], { stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      let err = ''
      proc.stdout.on('data', (b) => (out += b.toString('utf8')))
      proc.stderr.on('data', (b) => (err += b.toString('utf8')))
      proc.on('error', reject)
      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(err.trim() || `tshark -z expert failed (code=${code})`))
          return
        }
        resolve(out.trim())
      })
    })
  } catch {
    // ignore summary failures
  }

  return {
    filePath,
    generatedAt: new Date().toISOString(),
    total: items.length,
    countsBySeverity,
    summaryText,
    items
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

/* ------------------------------------------------------------------ */
/*  Auto-update helpers                                                */
/* ------------------------------------------------------------------ */

async function silentUpdateCheck(): Promise<void> {
  try {
    const result = await checkForUpdate(app.getVersion())
    if (!result.available) return
    const { info } = result
    const choice = dialog.showMessageBoxSync(mainWindow ? mainWindow : undefined!, {
      type: 'info',
      title: 'Update Available',
      message: `tcpwatch v${info.latestVersion} is available (you have v${info.currentVersion}).`,
      detail: info.releaseNotes
        ? info.releaseNotes.slice(0, 500)
        : `See release notes at ${info.releaseUrl}`,
      buttons: ['Download & Install', 'Later'],
      defaultId: 0,
    })
    if (choice === 0) {
      await downloadAndInstallUpdate(info, mainWindow)
    }
  } catch (err) {
    console.error('[updater] Silent check failed:', err)
  }
}

async function handleManualUpdateCheck(): Promise<void> {
  try {
    const result = await checkForUpdate(app.getVersion())
    if (!result.available) {
      dialog.showMessageBoxSync(mainWindow ? mainWindow : undefined!, {
        type: 'info',
        title: 'No Updates',
        message: `You are running the latest version (v${result.currentVersion}).`,
        buttons: ['OK'],
      })
      return
    }
    const { info } = result
    const choice = dialog.showMessageBoxSync(mainWindow ? mainWindow : undefined!, {
      type: 'info',
      title: 'Update Available',
      message: `tcpwatch v${info.latestVersion} is available (you have v${info.currentVersion}).`,
      detail: info.releaseNotes
        ? info.releaseNotes.slice(0, 500)
        : `See release notes at ${info.releaseUrl}`,
      buttons: ['Download & Install', 'Later'],
      defaultId: 0,
    })
    if (choice === 0) {
      await downloadAndInstallUpdate(info, mainWindow)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    dialog.showErrorBox('Update Check Failed', message)
  }
}

app.whenReady().then(() => {
  createWindow()

  // Set up application menu with "Check for Updates..."
  const menu = buildAppMenu({
    onCheckForUpdates: () => { handleManualUpdateCheck() },
  })
  Menu.setApplicationMenu(menu)

  // Auto-check for updates 5 seconds after startup (packaged app only)
  if (app.isPackaged) {
    setTimeout(() => { silentUpdateCheck() }, 5000)
  }

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

  ipcMain.handle('tcpwatch:processInfo', async (_evt, pid: unknown): Promise<{ output: string } | { error: string }> => {
    const parsed = typeof pid === 'number' ? pid : Number(pid)
    const targetPid = Math.trunc(parsed)
    if (!Number.isFinite(targetPid) || targetPid < 1) {
      return { error: `Invalid PID: ${String(pid)}` }
    }

    // Strip ANSI escape codes from output
    const stripAnsi = (str: string): string => {
      // eslint-disable-next-line no-control-regex
      return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
    }

    // Find witr binary - check common Go bin paths since Electron doesn't inherit user's shell PATH
    const findWitr = (): string => {
      const home = os.homedir()
      const candidates = [
        path.join(home, 'go', 'bin', 'witr'),
        '/usr/local/go/bin/witr',
        '/opt/homebrew/bin/witr',
        path.join(home, '.local', 'bin', 'witr')
      ]
      for (const candidate of candidates) {
        try {
          fs.accessSync(candidate, fs.constants.X_OK)
          return candidate
        } catch {
          // Not found or not executable, try next
        }
      }
      return 'witr' // Fallback to PATH lookup
    }

    const witrPath = findWitr()

    return new Promise((resolve) => {
      const cp = spawn(witrPath, ['-p', String(targetPid)], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10000
      })

      let stdout = ''
      let stderr = ''

      cp.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
      })

      cp.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })

      cp.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') {
          resolve({ error: 'witr is not installed. Install it with: go install github.com/morzer/witr@latest' })
        } else {
          resolve({ error: `Failed to run witr: ${err.message}` })
        }
      })

      cp.on('close', (code) => {
        if (code === 0) {
          resolve({ output: stripAnsi(stdout).trim() || 'No information available for this process.' })
        } else {
          resolve({ error: stripAnsi(stderr).trim() || `witr exited with code ${code}` })
        }
      })
    })
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
    async (_evt, opts: { dumpDir: string; ifaceId: string; durationSeconds: number; port?: unknown; snapLen?: unknown; captureFilter?: unknown }) => {
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

      const snapLen = normalizeSnapLen(opts.snapLen, 200)

      const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
      const filePath = path.join(opts.dumpDir, `tcpwatch-capture-${ts}.pcapng`)

      // Use the user-supplied capture filter if provided, otherwise fall back to port-based or plain tcp
      const userFilter = typeof opts.captureFilter === 'string' ? opts.captureFilter.trim() : ''
      const captureFilter = userFilter || (port ? `tcp port ${port}` : 'tcp')
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
        captureFilter,
        snapLen,
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
            await splitCaptureByTcpStream(captureStatus.filePath, captureStatus.dumpDir, captureStatus.snapLen)
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

  ipcMain.handle('tcpwatch:readSplitIndex', async (_evt, splitDir: unknown, opts: unknown) => {
    const input = String(splitDir ?? '').trim()
    if (!input) throw new Error('Split folder or capture file is required')

    if (!fs.existsSync(input)) throw new Error(`Path not found: ${input}`)

    const st = fs.statSync(input)

    // If user selected a capture file, auto-split it and return the generated index.
    if (st.isFile() && isPcapFile(input)) {
      const dumpDir = path.dirname(input)
      const snapLen = normalizeSnapLen((opts as { snapLen?: unknown } | null)?.snapLen, 200)
      const res = await splitCaptureByTcpStream(input, dumpDir, snapLen)
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

  ipcMain.handle('tcpwatch:expertInfo', async (_evt, filePath: unknown) => {
    const p = String(filePath ?? '').trim()
    if (!p) throw new Error('File path is required')
    if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`)
    const st = fs.statSync(p)
    if (!st.isFile()) throw new Error(`Not a file: ${p}`)
    if (!isPcapFile(p)) throw new Error('Unsupported file type. Expected .pcap or .pcapng')
    return await readExpertInfo(p)
  })

  ipcMain.handle('tcpwatch:analyzeCapture', async (_evt, filePath: unknown) => {
    const p = String(filePath ?? '').trim()
    if (!p) throw new Error('File path is required')
    if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`)
    const st = fs.statSync(p)
    if (!st.isFile()) throw new Error(`Not a file: ${p}`)
    if (!isPcapFile(p)) throw new Error('Unsupported file type. Expected .pcap or .pcapng')
    return await runPacketAnalysisWithClaude(p)
  })

  ipcMain.handle('tcpwatch:extractDns', async (_evt, filePath: unknown) => {
    const p = String(filePath ?? '').trim()
    if (!p) throw new Error('File path is required')
    if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`)
    const st = fs.statSync(p)
    if (!st.isFile()) throw new Error(`Not a file: ${p}`)
    if (!isPcapFile(p)) throw new Error('Unsupported file type. Expected .pcap or .pcapng')
    return await extractDnsFromCapture(p)
  })

  ipcMain.handle('tcpwatch:analyzeDnsCapture', async (_evt, filePath: unknown) => {
    const p = String(filePath ?? '').trim()
    if (!p) throw new Error('File path is required')
    if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`)
    const st = fs.statSync(p)
    if (!st.isFile()) throw new Error(`Not a file: ${p}`)
    if (!isPcapFile(p)) throw new Error('Unsupported file type. Expected .pcap or .pcapng')
    return await runDnsAnalysisWithClaude(p)
  })

  ipcMain.handle(
    'tcpwatch:validateCaptureFilter',
    async (_evt, filter: unknown, ifaceId: unknown) => {
      const f = String(filter ?? '').trim()
      if (!f) return { valid: false, error: 'Capture filter cannot be empty' }
      const iface = String(ifaceId ?? '').trim()
      const tshark = resolveTsharkPath()
      const args = ['-f', f, '-c', '0']
      if (iface) args.push('-i', iface)
      const result = spawnSync(tshark, args, { timeout: 5000, stdio: ['ignore', 'ignore', 'pipe'] })
      if (result.status === 0 || result.status === null) {
        return { valid: true }
      }
      const stderr = result.stderr?.toString('utf8').trim() ?? ''
      // tshark prints the error reason after the last colon in lines mentioning the filter
      const errorLine = stderr.split('\n').find((l: string) => l.includes('Invalid capture filter') || l.includes('syntax error'))
      return { valid: false, error: errorLine || stderr || 'Invalid capture filter' }
    },
  )

  ipcMain.handle('tcpwatch:checkForUpdate', async () => {
    const result = await checkForUpdate(app.getVersion())
    if (result.available) {
      return {
        available: true,
        currentVersion: result.info.currentVersion,
        latestVersion: result.info.latestVersion,
        releaseUrl: result.info.releaseUrl,
      }
    }
    return { available: false, currentVersion: app.getVersion() }
  })

  ipcMain.handle('tcpwatch:getAppVersion', async () => app.getVersion())

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopChild()
  if (process.platform !== 'darwin') app.quit()
})

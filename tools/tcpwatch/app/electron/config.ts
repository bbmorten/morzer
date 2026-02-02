import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import dotenv from 'dotenv'

export type AppConfig = {
  anthropicApiKey: string
  claudeModel: string
  mcpcapBin: string
  reverseDns: boolean
  tsharkBin: string
  editcapBin: string
  wiresharkBin: string
  tcpwatchBin: string
}

const DEFAULTS: AppConfig = {
  anthropicApiKey: '',
  claudeModel: '',
  mcpcapBin: '',
  reverseDns: true,
  tsharkBin: '',
  editcapBin: '',
  wiresharkBin: '',
  tcpwatchBin: '',
}

let cached: AppConfig | null = null

/* ------------------------------------------------------------------ */
/*  Paths                                                              */
/* ------------------------------------------------------------------ */

function resolveRepoRoot(): string {
  const appPath = app.isPackaged
    ? path.resolve(app.getAppPath(), '..')
    : path.resolve(app.getAppPath())
  // Walk up looking for .git
  let dir = appPath
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return appPath
}

export function getConfigPath(): string {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), 'config.json')
  }
  return path.join(resolveRepoRoot(), 'config.json')
}

function getDotenvPath(): string | null {
  if (app.isPackaged) {
    const p = path.join(app.getPath('userData'), '.env')
    return fs.existsSync(p) ? p : null
  }
  const root = resolveRepoRoot()
  const p = path.join(root, '.env')
  return fs.existsSync(p) ? p : null
}

/* ------------------------------------------------------------------ */
/*  Read / Write                                                       */
/* ------------------------------------------------------------------ */

export function loadConfig(): AppConfig {
  const configPath = getConfigPath()
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8')
      const parsed = JSON.parse(raw)
      const result: AppConfig = { ...DEFAULTS, ...parsed }
      cached = result
      return result
    }
  } catch (err) {
    console.warn(`[config] Failed to read ${configPath}:`, err)
  }
  const result: AppConfig = { ...DEFAULTS }
  cached = result
  return result
}

export function saveConfig(config: AppConfig): void {
  const configPath = getConfigPath()
  const dir = path.dirname(configPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8')
  cached = { ...config }
  console.log(`[config] Saved to ${configPath}`)
}

export function getConfig(): AppConfig {
  if (!cached) return loadConfig()
  return cached
}

/* ------------------------------------------------------------------ */
/*  Apply config to process.env (backward compatibility)               */
/* ------------------------------------------------------------------ */

const ENV_MAPPING: Array<[keyof AppConfig, string]> = [
  ['anthropicApiKey', 'ANTHROPIC_API_KEY'],
  ['claudeModel', 'TCPWATCH_CLAUDE_MODEL'],
  ['mcpcapBin', 'TCPWATCH_MCPCAP_BIN'],
  ['tsharkBin', 'TSHARK_BIN'],
  ['editcapBin', 'EDITCAP_BIN'],
  ['wiresharkBin', 'WIRESHARK_BIN'],
  ['tcpwatchBin', 'TCPWATCH_BIN'],
]

export function applyConfigToEnv(config: AppConfig): void {
  for (const [key, envVar] of ENV_MAPPING) {
    const val = String(config[key] ?? '').trim()
    // Only set if config has a value AND env is not already set from shell
    if (val && !process.env[envVar]) {
      process.env[envVar] = val
    }
  }
  // Boolean special case
  if (!process.env.TCPWATCH_RDNS) {
    process.env.TCPWATCH_RDNS = config.reverseDns ? '1' : '0'
  }
}

/* ------------------------------------------------------------------ */
/*  Migration from .env                                                */
/* ------------------------------------------------------------------ */

const DOTENV_TO_CONFIG: Array<[string, keyof AppConfig]> = [
  ['ANTHROPIC_API_KEY', 'anthropicApiKey'],
  ['TCPWATCH_CLAUDE_MODEL', 'claudeModel'],
  ['ANTHROPIC_MODEL', 'claudeModel'],
  ['TCPWATCH_MCPCAP_BIN', 'mcpcapBin'],
  ['MCPCAP_BIN', 'mcpcapBin'],
  ['TCPWATCH_RDNS', 'reverseDns'],
  ['TSHARK_BIN', 'tsharkBin'],
  ['EDITCAP_BIN', 'editcapBin'],
  ['WIRESHARK_BIN', 'wiresharkBin'],
  ['TCPWATCH_BIN', 'tcpwatchBin'],
]

export function migrateFromDotenv(): boolean {
  const configPath = getConfigPath()
  if (fs.existsSync(configPath)) return false

  const envPath = getDotenvPath()
  if (!envPath) return false

  try {
    const raw = fs.readFileSync(envPath, 'utf8')
    const parsed = dotenv.parse(raw)
    const config: AppConfig = { ...DEFAULTS }

    for (const [envKey, configKey] of DOTENV_TO_CONFIG) {
      const val = parsed[envKey]
      if (val !== undefined && val !== '') {
        if (configKey === 'reverseDns') {
          config.reverseDns = val !== '0' && val.toLowerCase() !== 'false'
        } else {
          ;(config as Record<string, unknown>)[configKey] = val
        }
      }
    }

    saveConfig(config)
    console.log(`[config] Migrated settings from ${envPath} to ${configPath}`)
    return true
  } catch (err) {
    console.warn(`[config] Migration from .env failed:`, err)
    return false
  }
}

import { existsSync, readFileSync } from 'node:fs'
import type { SessionPolicy } from './auth/sessions'

type Env = Record<string, string | undefined>

export interface WebConfig {
  appUrl: URL
  /** True when the panel is served over HTTPS: cookies get the Secure flag and the __Host- prefix. */
  secure: boolean
  dataDir: string
  authSecret: Buffer
  workerUrl: string
  workerToken: string
  /** How many reverse proxies sit in front (0 when the panel is reached directly). */
  trustedProxyHops: number
  policy: SessionPolicy
}

function fromEnvOrFile(env: Env, name: string): string | undefined {
  const direct = env[name]?.trim()
  if (direct) return direct
  const file = env[`${name}_FILE`]
  if (file) {
    if (!existsSync(file)) throw new Error(`${name}_FILE menunjuk ke berkas yang tidak ada.`)
    return readFileSync(file, 'utf8').trim()
  }
  return undefined
}

export function parseKey(value: string, name: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, 'hex')
  const b = Buffer.from(value, 'base64')
  if (b.length === 32) return b
  throw new Error(`${name} harus 32 byte: 64 karakter heksadesimal atau base64 dari 32 byte.`)
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/**
 * Reads the configuration and refuses to start in an unsafe shape: a panel reachable over plain HTTP from another
 * machine would send the session cookie in the clear, so anything but HTTPS (or localhost) is an error, never a warning.
 */
export function loadWebConfig(env: Env = process.env): WebConfig {
  let appUrl: URL
  try { appUrl = new URL(env.APP_URL ?? 'http://localhost:3000') } catch { throw new Error('APP_URL bukan URL yang valid.') }
  const secure = appUrl.protocol === 'https:'
  if (!secure && !(appUrl.protocol === 'http:' && LOOPBACK.has(appUrl.hostname)))
    throw new Error('APP_URL harus https:// (http:// hanya boleh untuk localhost). Cookie sesi tidak boleh lewat jaringan tanpa enkripsi.')
  const key = fromEnvOrFile(env, 'AUTH_SECRET_KEY')
  if (!key) throw new Error('AUTH_SECRET_KEY (atau AUTH_SECRET_KEY_FILE) wajib diisi.')
  const token = fromEnvOrFile(env, 'WORKER_TOKEN')
  if (!token) throw new Error('WORKER_TOKEN (atau WORKER_TOKEN_FILE) wajib diisi.')
  if (token.length < 32) throw new Error('WORKER_TOKEN minimal 32 karakter.')
  const num = (name: string, def: number, min: number, max: number): number => {
    const v = env[name] === undefined ? def : Number(env[name])
    if (!Number.isFinite(v) || v < min || v > max) throw new Error(`${name} harus antara ${min} dan ${max}.`)
    return v
  }
  const hops = num('TRUSTED_PROXY_HOPS', 0, 0, 5)
  return {
    appUrl, secure,
    dataDir: env.AUTH_DATA_DIR ?? '/data',
    authSecret: parseKey(key, 'AUTH_SECRET_KEY'),
    workerUrl: (env.WORKER_URL ?? 'http://worker:4000').replace(/\/+$/, ''),
    workerToken: token,
    trustedProxyHops: hops,
    policy: {
      ownerIdleMs: num('SESSION_IDLE_MINUTES', 30, 5, 1440) * 60_000,
      ownerAbsoluteMs: num('SESSION_ABSOLUTE_HOURS', 12, 1, 168) * 3_600_000
    }
  }
}

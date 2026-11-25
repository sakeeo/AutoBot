import { existsSync, readFileSync } from 'node:fs'

export interface WorkerConfig {
  dataDir: string
  host: string
  port: number
  /** Encrypts API keys and other secrets at rest (32 bytes). */
  secretKey: Buffer
  /** Shared with the web app; every request to the worker must carry it. */
  token: string
}

type Env = Record<string, string | undefined>

/** A value from NAME, or from the file named by NAME_FILE (a Docker secret). */
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

/** Accepts 64 hex characters or base64 of 32 bytes. */
export function parseSecretKey(value: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, 'hex')
  const b = Buffer.from(value, 'base64')
  if (b.length === 32) return b
  throw new Error('ENGINE_SECRET_KEY harus 32 byte: 64 karakter heksadesimal atau base64 dari 32 byte.')
}

/** Reads and checks the configuration. Never echoes a secret in an error message. */
export function loadConfig(env: Env = process.env): WorkerConfig {
  const key = fromEnvOrFile(env, 'ENGINE_SECRET_KEY')
  if (!key) throw new Error('ENGINE_SECRET_KEY (atau ENGINE_SECRET_KEY_FILE) wajib diisi.')
  const token = fromEnvOrFile(env, 'WORKER_TOKEN')
  if (!token) throw new Error('WORKER_TOKEN (atau WORKER_TOKEN_FILE) wajib diisi.')
  if (token.length < 32) throw new Error('WORKER_TOKEN minimal 32 karakter.')
  const port = Number(env.PORT ?? 4000)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT tidak valid.')
  return {
    dataDir: env.DATA_DIR ?? '/data',
    host: env.HOST ?? '0.0.0.0',
    port,
    secretKey: parseSecretKey(key),
    token
  }
}

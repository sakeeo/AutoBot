import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Settings } from '@autobot/contracts/types'

export const DEFAULT_SETTINGS: Settings = {
  mode: 'extractive',
  outOfContext: {
    action: 'reply',
    replyText:
      'Maaf, saya hanya bisa membantu seputar informasi yang tersedia. Admin akan membalas segera.'
  },
  threshold: 0.6,
  allowGroups: false,
  cooldownSec: 10,
  ai: { provider: 'claude', model: 'claude-haiku-5-5', maxTokens: 400 },
  theme: 'auto',
  notifyIncoming: true,
  memoryEnabled: true
}

export class SettingsStore {
  private current: Settings

  constructor(private file: string) {
    this.current = this.load()
  }

  private load(): Settings {
    if (!existsSync(this.file)) return structuredClone(DEFAULT_SETTINGS)
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8'))
      return { ...structuredClone(DEFAULT_SETTINGS), ...saved }
    } catch {
      return structuredClone(DEFAULT_SETTINGS)
    }
  }

  get(): Settings {
    return structuredClone(this.current)
  }

  update(patch: Partial<Settings>): Settings {
    this.current = { ...this.current, ...patch }
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(this.current, null, 2))
    return this.get()
  }
}

export interface SecretStore {
  set(name: string, value: string): void
  get(name: string): string | null
  has(name: string): boolean
  delete(name: string): void
}

export class MemorySecretStore implements SecretStore {
  private m = new Map<string, string>()
  set(name: string, value: string): void { this.m.set(name, value) }
  get(name: string): string | null { return this.m.get(name) ?? null }
  has(name: string): boolean { return this.m.has(name) }
  delete(name: string): void { this.m.delete(name) }
}

/**
 * Encrypted secrets file: AES-256-GCM with a random nonce per value. The key (32 bytes) comes from the deployment
 * (a Docker secret or environment variable kept outside the data volume), so stealing only the data file reveals nothing.
 * A value that does not authenticate (wrong key, corrupted or tampered file) is treated as absent, never returned.
 */
export class AesGcmSecretStore implements SecretStore {
  constructor(private file: string, private key: Buffer) {
    if (key.length !== 32) throw new Error('SECRET_KEY_MUST_BE_32_BYTES')
  }

  private read(): Record<string, string> {
    if (!existsSync(this.file)) return {}
    try { return JSON.parse(readFileSync(this.file, 'utf8')) } catch { return {} }
  }
  private write(o: Record<string, string>): void {
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(o), { mode: 0o600 })
    renameSync(tmp, this.file)
  }

  private seal(name: string, value: string): string {
    const nonce = randomBytes(12)
    const c = createCipheriv('aes-256-gcm', this.key, nonce)
    c.setAAD(Buffer.from(name)) // binds the value to its name: swapping two entries in the file fails to decrypt
    const enc = Buffer.concat([c.update(value, 'utf8'), c.final()])
    return Buffer.concat([nonce, c.getAuthTag(), enc]).toString('base64')
  }
  private open(name: string, sealed: string): string | null {
    try {
      const raw = Buffer.from(sealed, 'base64')
      const d = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12))
      d.setAAD(Buffer.from(name))
      d.setAuthTag(raw.subarray(12, 28))
      return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8')
    } catch {
      return null
    }
  }

  set(name: string, value: string): void {
    const o = this.read()
    o[name] = this.seal(name, value)
    this.write(o)
  }
  get(name: string): string | null {
    const v = this.read()[name]
    return v ? this.open(name, v) : null
  }
  has(name: string): boolean { return name in this.read() }
  delete(name: string): void {
    const o = this.read()
    delete o[name]
    this.write(o)
  }
}

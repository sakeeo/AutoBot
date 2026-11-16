import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Settings } from '../shared/types'

export const DEFAULT_SETTINGS: Settings = {
  knowledgeFolders: [],
  excludePatterns: [],
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
  autoStart: false,
  theme: 'auto'
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

/** Electron safeStorage-backed store; encrypted JSON file under userData. */
export class SafeStorageSecretStore implements SecretStore {
  constructor(
    private file: string,
    private safe: {
      isEncryptionAvailable(): boolean
      encryptString(s: string): Buffer
      decryptString(b: Buffer): string
    }
  ) {}

  private read(): Record<string, string> {
    if (!existsSync(this.file)) return {}
    try { return JSON.parse(readFileSync(this.file, 'utf8')) } catch { return {} }
  }
  private write(o: Record<string, string>): void {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(o), { mode: 0o600 })
  }

  set(name: string, value: string): void {
    if (!this.safe.isEncryptionAvailable()) throw new Error('OS encryption unavailable')
    const o = this.read()
    o[name] = this.safe.encryptString(value).toString('base64')
    this.write(o)
  }
  get(name: string): string | null {
    const v = this.read()[name]
    if (!v) return null
    try { return this.safe.decryptString(Buffer.from(v, 'base64')) } catch { return null }
  }
  has(name: string): boolean { return name in this.read() }
  delete(name: string): void {
    const o = this.read()
    delete o[name]
    this.write(o)
  }
}

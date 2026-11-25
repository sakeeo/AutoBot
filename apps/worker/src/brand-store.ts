import type { Db } from './db'
import { UserError } from './errors'
import {
  BrandProfileSchema, PRESETS, validateProfile,
  type BrandProfile, type Issue, type ValidateCtx
} from '@autobot/contracts/brand'

const MAX_VERSIONS = 20

function zodIssues(error: { issues: { path: PropertyKey[]; message: string }[] }): Issue[] {
  return error.issues.map((i) => ({
    level: 'error' as const,
    field: i.path.map(String).join('.') || '(root)',
    message: i.message
  }))
}

export class BrandStore {
  constructor(
    private db: Db,
    private clock: { now(): number },
    private ctx: () => ValidateCtx = () => ({ botNumber: null, productCount: 0 })
  ) {}

  getActive(): BrandProfile {
    const row = this.db.prepare('SELECT json FROM brand_versions ORDER BY version DESC LIMIT 1').get() as
      | { json: string }
      | undefined
    return row ? (JSON.parse(row.json) as BrandProfile) : structuredClone(PRESETS.kustom)
  }

  getDraft(): BrandProfile {
    const row = this.db.prepare('SELECT json FROM brand_draft WHERE id = 1').get() as { json: string } | undefined
    return row ? (JSON.parse(row.json) as BrandProfile) : this.getActive()
  }

  saveDraft(p: unknown): { ok: boolean; issues: Issue[] } {
    const parsed = BrandProfileSchema.safeParse(p)
    if (!parsed.success) return { ok: false, issues: zodIssues(parsed.error) }
    this.writeDraft(parsed.data)
    return { ok: true, issues: validateProfile(parsed.data, this.ctx()) }
  }

  apply(): { ok: boolean; issues: Issue[]; version?: number } {
    const draft = this.getDraft()
    const issues = validateProfile(draft, this.ctx())
    if (issues.some((i) => i.level === 'error')) return { ok: false, issues }
    const last = this.db.prepare('SELECT MAX(version) AS v FROM brand_versions').get() as { v: number | null }
    const version = (last.v ?? 0) + 1
    const next: BrandProfile = { ...draft, version }
    this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO brand_versions(version, json, created_at) VALUES (?, ?, ?)')
        .run(version, JSON.stringify(next), this.clock.now())
      this.db
        .prepare('DELETE FROM brand_versions WHERE version <= ?')
        .run(version - MAX_VERSIONS)
      this.writeDraft(next)
    })()
    return { ok: true, issues, version }
  }

  listVersions(): { version: number; createdAt: number }[] {
    return (
      this.db.prepare('SELECT version, created_at FROM brand_versions ORDER BY version DESC').all() as {
        version: number
        created_at: number
      }[]
    ).map((r) => ({ version: r.version, createdAt: r.created_at }))
  }

  restore(version: number): BrandProfile {
    const row = this.db.prepare('SELECT json FROM brand_versions WHERE version = ?').get(version) as
      | { json: string }
      | undefined
    if (!row) throw new UserError(`Versi ${version} tidak ditemukan.`, 'NOT_FOUND')
    const old = JSON.parse(row.json) as BrandProfile
    this.writeDraft(old)
    return this.apply().ok ? this.getActive() : old
  }

  exportJson(): string {
    return JSON.stringify(this.getActive(), null, 2)
  }

  importJson(json: string): { ok: boolean; issues: Issue[] } {
    let raw: unknown
    try {
      raw = JSON.parse(json)
    } catch {
      return { ok: false, issues: [{ level: 'error', field: '(root)', message: 'Berkas bukan JSON yang valid.' }] }
    }
    return this.saveDraft(raw)
  }

  private writeDraft(p: BrandProfile): void {
    this.db
      .prepare('INSERT INTO brand_draft(id, json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json')
      .run(JSON.stringify(p))
  }
}

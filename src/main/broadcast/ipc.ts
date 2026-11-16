import { randomUUID } from 'node:crypto'
import { AttestSchema, CampaignInputSchema, ConfirmTextSchema, IdSchema, ImportFileSchema, SafetyPatchSchema } from '../../shared/broadcast'
import type {
  Campaign, CampaignView, ContactStatus, Health, ImportPreviewView, OverviewView, ReportView, SafetyView
} from '../../shared/broadcast'
import type { BroadcastEngine, SafetySettings } from './engine'
import { ImportService, parseImport, type ImportPreview } from './import'
import { lintMessage } from './lint'
import { TIER_LIMITS, activeDayIndex, dailyCap, effectiveTier, localDay } from './limits'
import type { BroadcastStore } from './store'

const DEFAULT_WINDOW = { start: '09:00', end: '20:00', timezone: 'Asia/Makassar' }
const BIG_CAMPAIGN = 50
const CONFIRMATION_TEXT =
  'Halo {nama}, ini {bisnis}. Nomor Anda terdaftar di daftar kontak kami. Boleh kami kirimi informasi sesekali? Balas YA jika setuju.'

interface Stored extends Omit<SafetySettings, 'enabled'> { configured: boolean; enabled: boolean }

function readStored(store: BroadcastStore, now: number): Stored {
  const raw = store.getState('safety')
  const base: Stored = { configured: false, enabled: false, ageDays: 0, declaredAt: now, window: DEFAULT_WINDOW, minGapDays: 7, warmupFrom: 0 }
  if (!raw) return base
  try {
    return { ...base, ...(JSON.parse(raw) as Partial<Stored>) }
  } catch {
    return base
  }
}

/** The engine's view of the settings: nothing is enabled until the number's age has been declared. */
export function loadSafety(store: BroadcastStore, now: number): SafetySettings & { configured: boolean } {
  const s = readStored(store, now)
  return { ...s, enabled: s.enabled && s.configured }
}

const isLocked = (d: { isLocked(): boolean }): void => {
  if (d.isLocked()) throw new Error('LOCKED')
}

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** A spreadsheet reads a cell starting with = + - @ as a formula; a leading quote makes it plain text. */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export interface BroadcastIpcDeps {
  store: BroadcastStore
  engine: BroadcastEngine
  importer: ImportService
  clock: { now(): number }
  isLocked(): boolean
  businessName(): string
}

export function createBroadcastHandlers(d: BroadcastIpcDeps) {
  const { store, engine } = d
  const previews = new Map<string, { preview: ImportPreview; at: number }>()

  const safetyView = (): SafetyView => {
    const now = d.clock.now()
    const s = readStored(store, now)
    const tier = effectiveTier({ ageDays: s.ageDays, declaredAt: s.declaredAt }, now)
    const counters = store.counters(now, s.window.timezone)
    const from = localDay(s.warmupFrom, s.window.timezone)
    const activeDay = activeDayIndex(counters.sendDays.filter((x) => x >= from), localDay(now, s.window.timezone))
    return {
      configured: s.configured, enabled: s.enabled && s.configured, tier, ageDays: s.ageDays, activeDay,
      dailyCap: dailyCap(tier, activeDay), sentToday: counters.sentToday, window: s.window, minGapDays: s.minGapDays
    }
  }

  const ready = (): string | null => {
    const s = readStored(store, d.clock.now())
    return s.configured && s.enabled ? null : 'Lengkapi dan aktifkan pengaturan keamanan dulu (tab Keamanan).'
  }

  const health = (): Health => {
    const paused = store.listCampaigns().find((c) => c.status === 'dijeda')
    if (paused) return { level: 'dijeda', reason: paused.pauseReason ?? 'Kampanye dijeda.' }
    const v = safetyView()
    if (!v.configured) return { level: 'hati-hati', reason: 'Usia nomor belum dinyatakan; broadcast belum bisa dipakai.' }
    if (!v.enabled) return { level: 'hati-hati', reason: 'Broadcast sedang dimatikan.' }
    return { level: 'aman', reason: 'Tidak ada tanda bahaya.' }
  }

  const campaignView = (c: Campaign): CampaignView => ({ ...c, progress: store.progress(c.id) })

  return {
    // ---- reading ----
    bcOverview(): OverviewView {
      return {
        contacts: store.countByStatus(),
        suppressed: store.listSuppressed().length,
        pendingConfirm: store.audienceContacts('konfirmasi', 'impor').length,
        safety: safetyView(),
        health: health(),
        runningCampaignId: store.runningCampaign()?.id ?? null
      }
    },
    bcContacts(filter?: unknown) {
      const status = (filter as { status?: ContactStatus } | undefined)?.status
      return store.listContacts({ status, limit: 500 })
    },
    bcSuppressed() {
      return store.listSuppressed()
    },
    bcCampaigns(): CampaignView[] {
      return store.listCampaigns().map(campaignView)
    },
    bcPreviewCampaign(id: unknown) {
      return engine.preview(IdSchema.parse(id))
    },
    bcGetSafety(): SafetyView {
      return safetyView()
    },
    bcReport(id: unknown): ReportView {
      const c = store.getCampaign(IdSchema.parse(id))
      if (!c) throw new Error('Kampanye tidak ditemukan.')
      const skippedReasons: Record<string, number> = {}
      for (const r of store.reportRows(c.id)) if (r.status === 'dilewati') skippedReasons[r.reason ?? '?'] = (skippedReasons[r.reason ?? '?'] ?? 0) + 1
      return { campaign: c, progress: store.progress(c.id), skippedReasons, optOuts: store.eventsSince('optout', c.startedAt ?? 0) }
    },
    bcExportReport(id: unknown): string {
      const c = store.getCampaign(IdSchema.parse(id))
      if (!c) throw new Error('Kampanye tidak ditemukan.')
      const lines = ['nomor,nama,status,alasan,waktu']
      for (const r of store.reportRows(c.id))
        lines.push([r.number ?? '', r.name, r.status, r.reason ?? '', r.at ? new Date(r.at).toISOString() : ''].map(csvCell).join(','))
      return lines.join('\n')
    },

    // ---- writing (refused while locked) ----
    bcImportPreview(file: unknown): ImportPreviewView {
      isLocked(d)
      const parsed = parseImport(ImportFileSchema.parse(file))
      const now = d.clock.now()
      for (const [k, v] of previews) if (now - v.at > 10 * 60_000) previews.delete(k)
      if (previews.size >= 5) previews.delete(previews.keys().next().value as string)
      const previewId = randomUUID()
      previews.set(previewId, { preview: parsed, at: now })
      return {
        previewId, total: parsed.total, validCount: parsed.valid.length, invalidCount: parsed.invalid.length,
        duplicates: parsed.duplicates, invalid: parsed.invalid.slice(0, 20),
        sample: parsed.valid.slice(0, 5).map((v) => ({ number: v.number, name: v.name }))
      }
    },
    async bcImportCommit(previewId: unknown, attest: unknown) {
      isLocked(d)
      const a = AttestSchema.parse(attest)
      const id = typeof previewId === 'string' ? previewId : ''
      const held = previews.get(id)
      if (!held) throw new Error('PREVIEW_NOT_FOUND')
      previews.delete(id)
      return d.importer.commit(held.preview, a)
    },
    bcSendConfirmations() {
      isLocked(d)
      const notReady = ready()
      if (notReady) return { ok: false as const, error: notReady }
      if (store.audienceContacts('konfirmasi', 'impor').length === 0)
        return { ok: false as const, error: 'Tidak ada kontak yang menunggu konfirmasi.' }
      const c = store.createCampaign({ name: 'Konfirmasi kontak impor', kind: 'konfirmasi', template: CONFIRMATION_TEXT, audience: 'impor' })
      engine.start(c.id)
      return { ok: true as const, campaignId: c.id }
    },
    bcCreateCampaign(input: unknown) {
      isLocked(d)
      const i = CampaignInputSchema.parse(input)
      const lint = lintMessage(i.template, { businessName: d.businessName() })
      if (lint.errors.length > 0) return { ok: false as const, errors: lint.errors, warnings: lint.warnings }
      const campaign = store.createCampaign({ name: i.name, kind: 'broadcast', template: i.template, audience: i.audience })
      return { ok: true as const, campaign, warnings: lint.warnings }
    },
    bcStartCampaign(id: unknown, confirmText?: unknown) {
      isLocked(d)
      const cid = IdSchema.parse(id)
      const text = ConfirmTextSchema.parse(confirmText)
      const notReady = ready()
      if (notReady) return { ok: false as const, error: notReady }
      const c = store.getCampaign(cid)
      if (!c) return { ok: false as const, error: 'Kampanye tidak ditemukan.' }
      if (engine.preview(cid).eligible > BIG_CAMPAIGN && text !== 'KIRIM')
        return { ok: false as const, error: `Ketik KIRIM untuk memulai kampanye ke lebih dari ${BIG_CAMPAIGN} penerima.` }
      engine.start(cid)
      return { ok: true as const }
    },
    bcPauseCampaign(id: unknown) {
      isLocked(d)
      engine.pause(IdSchema.parse(id))
    },
    bcResumeCampaign(id: unknown) {
      isLocked(d)
      const cid = IdSchema.parse(id)
      const notReady = ready()
      if (notReady) return { ok: false as const, error: notReady }
      engine.start(cid)
      return { ok: true as const }
    },
    bcStopCampaign(id: unknown) {
      isLocked(d)
      engine.stop(IdSchema.parse(id))
    },
    /** Never refused: stopping must always be possible. */
    bcStopAll() {
      engine.stopAll()
    },
    bcSetSafety(patch: unknown) {
      isLocked(d)
      const parsed = SafetyPatchSchema.safeParse(patch)
      if (!parsed.success) return { ok: false as const, error: 'Pengaturan tidak valid.' }
      const p = parsed.data
      const now = d.clock.now()
      const s = readStored(store, now)
      if (p.window && toMinutes(p.window.start) >= toMinutes(p.window.end))
        return { ok: false as const, error: 'Jam mulai harus sebelum jam selesai.' }
      if (p.changeNumber) {
        if (!p.confirm) return { ok: false as const, error: 'Konfirmasi diperlukan untuk mengganti nomor.' }
        store.setState('safety', JSON.stringify({ ...s, configured: false, enabled: false, ageDays: 0, declaredAt: now, warmupFrom: now }))
        return { ok: true as const, safety: safetyView() }
      }
      if (p.ageDays !== undefined) {
        if (s.configured) return { ok: false as const, error: 'Usia nomor hanya bisa dinyatakan sekali; naik dengan sendirinya seiring waktu.' }
        s.ageDays = p.ageDays
        s.declaredAt = now
        s.configured = true
      }
      if (p.enabled !== undefined) s.enabled = p.enabled
      if (p.minGapDays !== undefined) s.minGapDays = p.minGapDays
      if (p.window) s.window = p.window
      store.setState('safety', JSON.stringify(s))
      return { ok: true as const, safety: safetyView() }
    },
    bcEraseContact(id: unknown) {
      isLocked(d)
      store.eraseContact(IdSchema.parse(id))
    }
  }
}

export type BroadcastHandlers = ReturnType<typeof createBroadcastHandlers>
export { TIER_LIMITS }

import type { BrandStore } from './brand-store'
import type { CatalogStore } from './catalog/catalog-store'
import type { IndexStore } from './knowledge/index-store'
import type { AiProvider } from './answer/ai-answerer'
import type { WaGateway } from './wa/gateway'
import { openDb } from './db'
import { ConversationStore } from './conversation/store'
import { HandoffService } from './conversation/handoff'
import { ConversationAgent, type AgentTurnResult } from './pipeline/conversation-agent'
import { PRESETS, type BrandProfile, type Issue, type PresetId } from '../shared/brand'
import {
  MAX_BRAND_JSON, PreviewInputSchema, VersionSchema,
  type AgentTurnView, type BrandSnapshot, type PreviewChatResult
} from '../shared/ipc'
import type { ConnStatus, IncomingMessage } from '../shared/types'

const PRESET_LABELS: Record<PresetId, string> = {
  toko_online: 'Toko Online',
  jasa_agensi: 'Jasa / Agensi',
  kuliner: 'Kuliner',
  klinik_salon: 'Klinik / Salon',
  pendidikan: 'Pendidikan / Kursus',
  properti: 'Properti',
  kustom: 'Kustom'
}

const err = (field: string, message: string): Issue => ({ level: 'error', field, message })
const tooBig = (x: unknown): boolean => {
  try {
    return JSON.stringify(x).length > MAX_BRAND_JSON
  } catch {
    return true
  }
}

/** A gateway that sends nothing: simulations must never reach a real customer or admin. */
class SilentGateway implements WaGateway {
  constructor(private real: WaGateway) {}
  onMessage(_cb: (m: IncomingMessage) => void): void {}
  onStatus(_cb: (s: ConnStatus) => void): void {}
  async connect(): Promise<void> {}
  async logout(): Promise<void> {}
  selfNumber(): string | null { return this.real.selfNumber() }
  async onWhatsApp(numbers: string[]): Promise<{ number: string; jid: string | null; exists: boolean }[]> {
    return numbers.map((number) => ({ number, jid: `${number}@s.whatsapp.net`, exists: true }))
  }
  jidFor(n: string): string { return this.real.jidFor(n) }
  async sendText(): Promise<string | null> { return null }
}

const toView = (r: AgentTurnResult): AgentTurnView => ({
  intent: r.intent,
  action: r.action,
  replyParts: r.replyParts,
  linkSent: r.linkSent,
  handoff: r.handoff,
  sources: r.sources,
  matchedRule: r.matchedRule,
  removed: r.removed,
  fallback: r.fallback,
  hits: r.hits.map((h) => ({ file: h.file, text: h.text, coverage: h.coverage }))
})

export interface BrandHandlers {
  getBrand(): Promise<BrandSnapshot>
  saveBrandDraft(p: unknown): Promise<{ ok: boolean; issues: Issue[] }>
  applyBrand(): Promise<{ ok: boolean; issues: Issue[]; version?: number }>
  listBrandVersions(): Promise<{ version: number; createdAt: number }[]>
  restoreBrandVersion(v: unknown): Promise<{ ok: boolean; error?: string }>
  exportBrand(): Promise<string>
  importBrand(json: unknown): Promise<{ ok: boolean; issues: Issue[] }>
  previewChat(input: unknown): Promise<PreviewChatResult>
  listPresets(): Promise<{ id: string; label: string }[]>
  loadPreset(id: unknown): Promise<{ ok: boolean; issues: Issue[]; error?: string }>
}

/** Electron-free handlers behind the brand IPC channels (so they can be unit-tested). */
export function createBrandHandlers(d: {
  brand: BrandStore
  catalog: CatalogStore
  store: IndexStore
  gateway: WaGateway
  clock: { now(): number }
  getProvider(): { provider: AiProvider; cfg: { model: string; maxTokens: number } } | null
}): BrandHandlers {
  return {
    async getBrand() {
      return {
        active: d.brand.getActive(),
        draft: d.brand.getDraft(),
        botNumber: d.gateway.selfNumber(),
        productCount: d.catalog.list().length
      }
    },
    async saveBrandDraft(p) {
      if (tooBig(p)) return { ok: false, issues: [err('(root)', 'Profil terlalu besar (maks 200 KB).')] }
      return d.brand.saveDraft(p)
    },
    async applyBrand() {
      return d.brand.apply()
    },
    async listBrandVersions() {
      return d.brand.listVersions()
    },
    async restoreBrandVersion(v) {
      const parsed = VersionSchema.safeParse(v)
      if (!parsed.success) return { ok: false, error: 'Nomor versi tidak valid.' }
      try {
        d.brand.restore(parsed.data)
        return { ok: true }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    },
    async exportBrand() {
      return d.brand.exportJson()
    },
    async importBrand(json) {
      if (typeof json !== 'string' || json.length > MAX_BRAND_JSON)
        return { ok: false, issues: [err('(root)', 'Berkas profil tidak valid atau terlalu besar (maks 200 KB).')] }
      return d.brand.importJson(json)
    },
    async listPresets() {
      return (Object.keys(PRESETS) as PresetId[]).map((id) => ({ id, label: PRESET_LABELS[id] }))
    },
    async loadPreset(id) {
      if (typeof id !== 'string' || !(id in PRESETS)) return { ok: false, issues: [], error: 'Preset tidak dikenal.' }
      const draft = d.brand.getDraft()
      const preset = structuredClone(PRESETS[id as PresetId])
      // Keep what the user typed about their own business; swap the strategy (rules, goal, templates).
      const next: BrandProfile = {
        ...preset, version: draft.version, identity: draft.identity, admins: draft.admins, links: draft.links
      }
      return d.brand.saveDraft(next)
    },
    async previewChat(input): Promise<PreviewChatResult> {
      const parsed = PreviewInputSchema.safeParse(input)
      if (!parsed.success) return { ok: false, error: 'Masukkan 1–10 pesan, masing-masing maksimal 2000 karakter.' }
      const ai = d.getProvider()
      if (!ai) return { ok: false, error: 'Mode AI belum siap: simpan API key di menu AI dulu.' }
      const profile = parsed.data.draft ? d.brand.getDraft() : d.brand.getActive()

      // Temporary memory and a silent gateway: the simulation leaves no trace and contacts nobody.
      const gateway = new SilentGateway(d.gateway)
      const conv = new ConversationStore(openDb(':memory:'), d.clock)
      const agent = new ConversationAgent({
        store: d.store, catalog: d.catalog, conv,
        handoff: new HandoffService({ gateway, conv, clock: d.clock }),
        gateway, clock: d.clock
      })
      const turns: AgentTurnView[] = []
      for (const text of parsed.data.messages) {
        const r = await agent.handleTurn({
          chatId: '__simulasi__', text, profile, provider: ai.provider, cfg: ai.cfg, dryRun: false
        })
        turns.push(toView(r))
      }
      return { ok: true, turns }
    }
  }
}

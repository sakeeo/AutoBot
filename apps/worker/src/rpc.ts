import { rm } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { z } from 'zod'
import type { Db } from './db'
import type { Indexer } from './knowledge/indexer'
import type { IndexStore } from './knowledge/index-store'
import type { ReplyPipeline } from './pipeline/reply-pipeline'
import type { MessageFeed } from './messages/message-feed'
import type { ConversationStore } from './conversation/store'
import type { SecretStore, SettingsStore } from './settings'
import type { AiProvider } from './answer/ai-answerer'
import type { WaGateway } from './wa/gateway'
import type { ConnStatus, Settings } from '@autobot/contracts/types'
import { CHANNELS as C } from '@autobot/contracts/channels'
import { ApiKeySchema, BulkHandlingSchema, ChatIdSchema, LimitSchema, MemoryPatchSchema, QuestionSchema, SettingsPatchSchema, TestHistorySchema, type LogRow } from '@autobot/contracts/ipc'
import { buildDashboard } from './stats'
import { listModels, saveApiKey } from './ai-key'
import type { BrandHandlers } from './brand-ipc'
import { resolveKnownFile } from './knowledge/files'
import { UserError } from './errors'
import { PROVIDERS, resolveBaseUrl, secretNameFor } from '@autobot/contracts/providers'

export interface RpcDeps {
  gateway: WaGateway
  getStatus(): ConnStatus
  indexer: Indexer
  store: IndexStore
  settings: SettingsStore
  secrets: SecretStore
  pipeline: ReplyPipeline
  db: Db
  knowledgeDir: string
  makeProvider(ai: Settings['ai'], key: string): AiProvider
  onSettingsChanged(prev: Settings, next: Settings): void
  brandHandlers: BrandHandlers
  feed: MessageFeed
  conv: ConversationStore
}

/** One RPC method: validates its own arguments (zod) and returns a JSON-serialisable result. */
export type RpcHandler = (...args: any[]) => unknown
export type RpcHandlers = Record<string, RpcHandler>

/** Method name = key of CHANNELS (the same name the browser client calls). */
const methodOf = (channel: string): string => {
  const hit = Object.entries(C).find(([, v]) => v === channel)
  if (!hit) throw new Error(`unknown channel ${channel}`)
  return hit[0]
}

export function buildRpc(d: RpcDeps): RpcHandlers {
  const handlers: RpcHandlers = {}
  const handle = (channel: string, fn: RpcHandler): void => { handlers[methodOf(channel)] = fn }
  handle(C.getStatus, () => d.getStatus())
  handle(C.connect, () => d.gateway.connect())
  handle(C.logout, () => d.gateway.logout())

  handle(C.getSettings, () => d.settings.get())
  handle(C.updateSettings, (raw: unknown) => {
    const patch = SettingsPatchSchema.parse(raw)
    const prev = d.settings.get()
    const ai = patch.ai ? { ...prev.ai, ...patch.ai } : prev.ai
    const hasKey = d.secrets.has(secretNameFor(ai.provider))
    if (patch.mode === 'ai' && !hasKey) throw new UserError('API key belum diatur.')
    // Switching to a provider that has no key yet must not leave AI mode on with nothing to call.
    const mode = patch.mode ?? (prev.mode === 'ai' && !hasKey ? 'extractive' : prev.mode)
    const next = d.settings.update({ ...patch, mode, ai })
    d.onSettingsChanged(prev, next)
    return next
  })

  handle(C.listFiles, () => d.store.listFiles().map((f) => ({ ...f, file: relative(d.knowledgeDir, f.file) })))
  handle(C.reindex, () => d.indexer.reindexAll())

  // Files cross the boundary by their name inside the knowledge folder; absolute paths never leave the server.
  const NameSchema = z.string().min(1).max(1024)
  const knownFile = (name: unknown): string =>
    resolveKnownFile(resolve(d.knowledgeDir, NameSchema.parse(name)), [d.knowledgeDir], d.store)
  handle(C.kbDelete, async (name: unknown) => {
    const f = knownFile(name)
    if (relative(d.knowledgeDir, f).split(/[\\/]/)[0] === '_gsheets') throw new UserError('Berkas ini berasal dari Google Sheets. Kelola lewat sumber Google Sheets.')
    await rm(f, { force: true })
    await d.indexer.removeFile(f)
    return { ok: true }
  })

  handle(C.testQuestion, (q: unknown, history?: unknown) => d.pipeline.preview(QuestionSchema.parse(q), TestHistorySchema.parse(history ?? [])))

  handle(C.saveApiKey, (key: unknown) => {
    const parsed = ApiKeySchema.safeParse(key)
    if (!parsed.success) return { ok: false, error: 'API key tidak valid.' }
    const ai = d.settings.get().ai
    return saveApiKey(
      {
        secrets: d.secrets,
        makeProvider: (k) => d.makeProvider(ai, k),
        ai,
        secretName: secretNameFor(ai.provider),
        configError:
          ai.provider === 'custom' && !resolveBaseUrl('custom', ai.baseUrl) ? 'Isi URL endpoint terlebih dahulu.' : undefined
      },
      parsed.data
    )
  })
  handle(C.listModels, async () => {
    const ai = d.settings.get().ai
    const key = d.secrets.get(secretNameFor(ai.provider))
    if (!key) return { ok: false, error: 'Hubungkan API key terlebih dahulu.' }
    const r = await listModels(d.makeProvider(ai, key))
    return r.ok ? r : { ok: false, error: r.error }
  })
  handle(C.hasApiKey, () => d.secrets.has(secretNameFor(d.settings.get().ai.provider)))
  handle(C.deleteApiKey, () => {
    d.secrets.delete(secretNameFor(d.settings.get().ai.provider))
    const prev = d.settings.get()
    if (prev.mode === 'ai') d.onSettingsChanged(prev, d.settings.update({ mode: 'extractive' }))
  })
  handle(C.consoleUrl, () => PROVIDERS[d.settings.get().ai.provider].consoleUrl ?? null)

  const b = d.brandHandlers
  handle(C.getBrand, () => b.getBrand())
  handle(C.saveBrandDraft, (p: unknown) => b.saveBrandDraft(p))
  handle(C.applyBrand, () => b.applyBrand())
  handle(C.listBrandVersions, () => b.listBrandVersions())
  handle(C.restoreBrandVersion, (v: unknown) => b.restoreBrandVersion(v))
  handle(C.exportBrand, () => b.exportBrand())
  handle(C.importBrand, (json: unknown) => b.importBrand(json))
  handle(C.previewChat, (input: unknown) => b.previewChat(input))
  handle(C.listPresets, () => b.listPresets())
  handle(C.loadPreset, (id: unknown) => b.loadPreset(id))

  handle(C.getLog, (limit: unknown): LogRow[] =>
    d.db
      .prepare(
        `SELECT message_id, chat_id, decision, top_score, sources, created_at, text
         FROM message_log ORDER BY created_at DESC LIMIT ?`
      )
      .all(LimitSchema.parse(limit)) as LogRow[]
  )

  handle(C.getHandling, (chatId: unknown) => {
    const s = d.conv.getState(ChatIdSchema.parse(chatId))
    return s.status
  })
  handle(C.takeOverChat, (chatId: unknown) => d.conv.takeOver(ChatIdSchema.parse(chatId)))
  handle(C.handBackChat, (chatId: unknown) => d.conv.resume(ChatIdSchema.parse(chatId)))
  handle(C.setHandlingBulk, (chatIds: unknown, to: unknown) => {
    const i = BulkHandlingSchema.parse({ chatIds, to })
    return { changed: d.conv.setHandlingBulk(i.chatIds, i.to) }
  })
  handle(C.sendAsAdmin, async (chatId: unknown, text: unknown) => {
    const id = ChatIdSchema.parse(chatId)
    const t = QuestionSchema.parse(text)
    if (id.endsWith('@g.us') || id.endsWith('@broadcast')) return { ok: false as const, error: 'Hanya untuk chat pelanggan.' }
    try {
      await d.pipeline.adminSend(id, t)
      return { ok: true as const }
    } catch {
      return { ok: false as const, error: 'Pesan gagal terkirim. Pastikan WhatsApp terhubung.' }
    }
  })
  handle(C.memGet, (chatId: unknown) => {
    const m = d.conv.getMemory(ChatIdSchema.parse(chatId))
    return { summary: m.summary, facts: m.facts }
  })
  handle(C.memUpdate, (chatId: unknown, patch: unknown) => {
    const id = ChatIdSchema.parse(chatId)
    const p = MemoryPatchSchema.parse(patch)
    if (p.facts) d.conv.setFacts(id, p.facts)
    if (p.summary !== undefined) d.conv.setSummary(id, p.summary.trim())
  })
  handle(C.memForget, (chatId: unknown) => d.conv.clearMemory(ChatIdSchema.parse(chatId)))
  handle(C.eraseCustomer, (chatId: unknown) => {
    const id = ChatIdSchema.parse(chatId)
    // WhatsApp status and broadcast lists are not customers; refusing them keeps the filter for them meaningful.
    if (id.endsWith('@broadcast')) throw new UserError('Bukan chat pelanggan.')
    return { removed: d.conv.eraseCustomer(id).removed }
  })
  handle(C.listChats, () => d.feed.chats())
  handle(C.getThread, (chatId: unknown) => d.feed.thread(ChatIdSchema.parse(chatId)))
  handle(C.getDashboard, () => buildDashboard(d.db, Date.now()))
  return handlers
}

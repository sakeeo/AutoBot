import { dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import type { Db } from './db'
import type { Indexer } from './knowledge/indexer'
import type { IndexStore } from './knowledge/index-store'
import type { ReplyPipeline } from './pipeline/reply-pipeline'
import type { SecretStore, SettingsStore } from './settings'
import type { AiProvider } from './answer/ai-answerer'
import type { WaGateway } from './wa/gateway'
import type { ConnStatus, Settings } from '../shared/types'
import { CHANNELS as C } from '../shared/channels'
import { ApiKeySchema, LimitSchema, QuestionSchema, SettingsPatchSchema, type LogRow } from '../shared/ipc'
import { saveApiKey } from './ai-key'
import type { BrandHandlers } from './brand-ipc'
import { PROVIDERS, resolveBaseUrl, secretNameFor } from '../shared/providers'

export interface IpcDeps {
  gateway: WaGateway
  getStatus(): ConnStatus
  indexer: Indexer
  store: IndexStore
  settings: SettingsStore
  secrets: SecretStore
  pipeline: ReplyPipeline
  db: Db
  makeProvider(ai: Settings['ai'], key: string): AiProvider
  getWindow(): BrowserWindow | null
  onSettingsChanged(prev: Settings, next: Settings): void
  brandHandlers: BrandHandlers
}

export function registerIpc(d: IpcDeps): void {
  ipcMain.handle(C.getStatus, () => d.getStatus())
  ipcMain.handle(C.connect, () => d.gateway.connect())
  ipcMain.handle(C.logout, () => d.gateway.logout())

  ipcMain.handle(C.getSettings, () => d.settings.get())
  ipcMain.handle(C.updateSettings, (_e, raw: unknown) => {
    const patch = SettingsPatchSchema.parse(raw)
    const prev = d.settings.get()
    const ai = patch.ai ? { ...prev.ai, ...patch.ai } : prev.ai
    const hasKey = d.secrets.has(secretNameFor(ai.provider))
    if (patch.mode === 'ai' && !hasKey) throw new Error('API key belum diatur.')
    // Switching to a provider that has no key yet must not leave AI mode on with nothing to call.
    const mode = patch.mode ?? (prev.mode === 'ai' && !hasKey ? 'extractive' : prev.mode)
    const next = d.settings.update({ ...patch, mode, ai })
    d.onSettingsChanged(prev, next)
    return next
  })

  ipcMain.handle(C.pickFolder, async () => {
    const win = d.getWindow()
    const opts = { properties: ['openDirectory' as const] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })
  ipcMain.handle(C.listFiles, () => d.store.listFiles())
  ipcMain.handle(C.reindex, () => d.indexer.reindexAll())

  ipcMain.handle(C.testQuestion, (_e, q: unknown) => d.pipeline.preview(QuestionSchema.parse(q)))

  ipcMain.handle(C.saveApiKey, (_e, key: unknown) => {
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
  ipcMain.handle(C.hasApiKey, () => d.secrets.has(secretNameFor(d.settings.get().ai.provider)))
  ipcMain.handle(C.deleteApiKey, () => {
    d.secrets.delete(secretNameFor(d.settings.get().ai.provider))
    const prev = d.settings.get()
    if (prev.mode === 'ai') d.onSettingsChanged(prev, d.settings.update({ mode: 'extractive' }))
  })
  ipcMain.handle(C.openConsole, () => {
    const url = PROVIDERS[d.settings.get().ai.provider].consoleUrl
    return url ? shell.openExternal(url) : undefined
  })

  const b = d.brandHandlers
  ipcMain.handle(C.getBrand, () => b.getBrand())
  ipcMain.handle(C.saveBrandDraft, (_e, p: unknown) => b.saveBrandDraft(p))
  ipcMain.handle(C.applyBrand, () => b.applyBrand())
  ipcMain.handle(C.listBrandVersions, () => b.listBrandVersions())
  ipcMain.handle(C.restoreBrandVersion, (_e, v: unknown) => b.restoreBrandVersion(v))
  ipcMain.handle(C.exportBrand, () => b.exportBrand())
  ipcMain.handle(C.importBrand, (_e, json: unknown) => b.importBrand(json))
  ipcMain.handle(C.previewChat, (_e, input: unknown) => b.previewChat(input))
  ipcMain.handle(C.listPresets, () => b.listPresets())
  ipcMain.handle(C.loadPreset, (_e, id: unknown) => b.loadPreset(id))

  ipcMain.handle(C.getLog, (_e, limit: unknown): LogRow[] =>
    d.db
      .prepare(
        `SELECT message_id, chat_id, decision, top_score, sources, created_at, text
         FROM message_log ORDER BY created_at DESC LIMIT ?`
      )
      .all(LimitSchema.parse(limit)) as LogRow[]
  )
}

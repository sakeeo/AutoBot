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
import { API_KEY_SECRET, saveApiKey } from './ai-key'

export const ANTHROPIC_CONSOLE_URL = 'https://console.anthropic.com/settings/keys'

export interface IpcDeps {
  gateway: WaGateway
  getStatus(): ConnStatus
  indexer: Indexer
  store: IndexStore
  settings: SettingsStore
  secrets: SecretStore
  pipeline: ReplyPipeline
  db: Db
  makeProvider(key: string): AiProvider
  getWindow(): BrowserWindow | null
  onSettingsChanged(prev: Settings, next: Settings): void
}

export function registerIpc(d: IpcDeps): void {
  ipcMain.handle(C.getStatus, () => d.getStatus())
  ipcMain.handle(C.connect, () => d.gateway.connect())
  ipcMain.handle(C.logout, () => d.gateway.logout())

  ipcMain.handle(C.getSettings, () => d.settings.get())
  ipcMain.handle(C.updateSettings, (_e, raw: unknown) => {
    const patch = SettingsPatchSchema.parse(raw)
    if (patch.mode === 'ai' && !d.secrets.has(API_KEY_SECRET)) throw new Error('API key belum diatur.')
    const prev = d.settings.get()
    const next = d.settings.update({ ...patch, ai: patch.ai ? { ...prev.ai, ...patch.ai } : prev.ai })
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
    return saveApiKey({ secrets: d.secrets, makeProvider: d.makeProvider, ai: d.settings.get().ai }, parsed.data)
  })
  ipcMain.handle(C.hasApiKey, () => d.secrets.has(API_KEY_SECRET))
  ipcMain.handle(C.deleteApiKey, () => {
    d.secrets.delete(API_KEY_SECRET)
    const prev = d.settings.get()
    if (prev.mode === 'ai') d.onSettingsChanged(prev, d.settings.update({ mode: 'extractive' }))
  })
  ipcMain.handle(C.openConsole, () => shell.openExternal(ANTHROPIC_CONSOLE_URL))

  ipcMain.handle(C.getLog, (_e, limit: unknown): LogRow[] =>
    d.db
      .prepare(
        `SELECT message_id, chat_id, decision, top_score, sources, created_at, text
         FROM message_log ORDER BY created_at DESC LIMIT ?`
      )
      .all(LimitSchema.parse(limit)) as LogRow[]
  )
}

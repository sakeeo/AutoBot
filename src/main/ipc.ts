import { app, dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type { Db } from './db'
import type { Indexer } from './knowledge/indexer'
import type { IndexStore } from './knowledge/index-store'
import type { ReplyPipeline } from './pipeline/reply-pipeline'
import type { MessageFeed } from './messages/message-feed'
import type { BroadcastHandlers } from './broadcast/ipc'
import type { SecretStore, SettingsStore } from './settings'
import type { AiProvider } from './answer/ai-answerer'
import type { WaGateway } from './wa/gateway'
import type { ConnStatus, Settings } from '../shared/types'
import { CHANNELS as C } from '../shared/channels'
import { ApiKeySchema, ChatIdSchema, LimitSchema, QuestionSchema, SettingsPatchSchema, type LogRow } from '../shared/ipc'
import { buildDashboard } from './stats'
import { saveApiKey } from './ai-key'
import type { BrandHandlers } from './brand-ipc'
import { AUTH_CHANNELS, guardHandler, type AuthHandlers } from './auth/auth-ipc'
import { mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { z } from 'zod'
import { deleteKnownFile, importFiles, resolveKnownFile } from './knowledge/files'
import { SUPPORTED_EXTENSIONS } from './knowledge/loaders'
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
  auth: AuthHandlers
  feed: MessageFeed
  broadcast: BroadcastHandlers
}

/** Channels that must work even while the app is locked: stopping a broadcast is never refused. */
const ALWAYS_ALLOWED: ReadonlySet<string> = new Set([C.bcStopAll])

export function registerIpc(d: IpcDeps): void {
  // Every channel goes through the lock gate; only auth:* channels work while locked.
  const handle = (channel: string, fn: (e: IpcMainInvokeEvent, ...a: any[]) => unknown): void =>
    ipcMain.handle(channel, guardHandler(d.auth.isLocked, AUTH_CHANNELS.has(channel) || ALWAYS_ALLOWED.has(channel), fn))
  handle(C.getStatus, () => d.getStatus())
  handle(C.connect, () => d.gateway.connect())
  handle(C.logout, () => d.gateway.logout())

  handle(C.getSettings, () => d.settings.get())
  handle(C.updateSettings, (_e, raw: unknown) => {
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

  handle(C.pickFolder, async () => {
    const win = d.getWindow()
    const opts = { properties: ['openDirectory' as const] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })
  handle(C.listFiles, () => d.store.listFiles())
  handle(C.reindex, () => d.indexer.reindexAll())

  const PathSchema = z.string().min(1).max(4096)
  handle(C.kbUpload, async (_e, folderArg: unknown) => {
    const settings = d.settings.get()
    const asked = typeof folderArg === 'string' ? folderArg : undefined
    if (asked && !settings.knowledgeFolders.includes(asked)) throw new Error('FOLDER_NOT_FOUND')
    const opts = {
      properties: ['openFile' as const, 'multiSelections' as const],
      filters: [{ name: 'Dokumen pengetahuan', extensions: SUPPORTED_EXTENSIONS.map((x) => x.slice(1)) }]
    }
    const win = d.getWindow()
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || r.filePaths.length === 0) return { canceled: true, folder: null, added: [], rejected: [] }
    // With no folder configured yet, uploads go to a default folder inside the app's data directory.
    let folder = asked ?? settings.knowledgeFolders[0]
    let created = false
    if (!folder) {
      folder = join(app.getPath('userData'), 'knowledge')
      mkdirSync(folder, { recursive: true })
      created = true
    }
    const res = await importFiles(r.filePaths, folder)
    if (created && res.added.length > 0) {
      const prev = d.settings.get()
      d.onSettingsChanged(prev, d.settings.update({ knowledgeFolders: [...prev.knowledgeFolders, folder] }))
    }
    return { canceled: false, folder, ...res }
  })
  handle(C.kbDownload, async (_e, file: unknown) => {
    const f = resolveKnownFile(PathSchema.parse(file), d.settings.get().knowledgeFolders, d.store)
    const win = d.getWindow()
    const opts = { defaultPath: basename(f) }
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return { ok: false, canceled: true }
    const { copyFile } = await import('node:fs/promises')
    await copyFile(f, r.filePath)
    return { ok: true }
  })
  handle(C.kbDelete, async (_e, file: unknown) => {
    await deleteKnownFile(PathSchema.parse(file), d.settings.get().knowledgeFolders, d.store)
    return { ok: true }
  })

  handle(C.testQuestion, (_e, q: unknown) => d.pipeline.preview(QuestionSchema.parse(q)))

  handle(C.saveApiKey, (_e, key: unknown) => {
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
  handle(C.hasApiKey, () => d.secrets.has(secretNameFor(d.settings.get().ai.provider)))
  handle(C.deleteApiKey, () => {
    d.secrets.delete(secretNameFor(d.settings.get().ai.provider))
    const prev = d.settings.get()
    if (prev.mode === 'ai') d.onSettingsChanged(prev, d.settings.update({ mode: 'extractive' }))
  })
  handle(C.openConsole, () => {
    const url = PROVIDERS[d.settings.get().ai.provider].consoleUrl
    return url ? shell.openExternal(url) : undefined
  })

  const b = d.brandHandlers
  handle(C.getBrand, () => b.getBrand())
  handle(C.saveBrandDraft, (_e, p: unknown) => b.saveBrandDraft(p))
  handle(C.applyBrand, () => b.applyBrand())
  handle(C.listBrandVersions, () => b.listBrandVersions())
  handle(C.restoreBrandVersion, (_e, v: unknown) => b.restoreBrandVersion(v))
  handle(C.exportBrand, () => b.exportBrand())
  handle(C.importBrand, (_e, json: unknown) => b.importBrand(json))
  handle(C.previewChat, (_e, input: unknown) => b.previewChat(input))
  handle(C.listPresets, () => b.listPresets())
  handle(C.loadPreset, (_e, id: unknown) => b.loadPreset(id))

  handle(C.getLog, (_e, limit: unknown): LogRow[] =>
    d.db
      .prepare(
        `SELECT message_id, chat_id, decision, top_score, sources, created_at, text
         FROM message_log ORDER BY created_at DESC LIMIT ?`
      )
      .all(LimitSchema.parse(limit)) as LogRow[]
  )

  const bc = d.broadcast
  handle(C.bcOverview, () => bc.bcOverview())
  handle(C.bcContacts, (_e, f: unknown) => bc.bcContacts(f))
  handle(C.bcSuppressed, () => bc.bcSuppressed())
  handle(C.bcImportPreview, (_e, f: unknown) => bc.bcImportPreview(f))
  handle(C.bcImportCommit, (_e, id: unknown, a: unknown) => bc.bcImportCommit(id, a))
  handle(C.bcSendConfirmations, () => bc.bcSendConfirmations())
  handle(C.bcCampaigns, () => bc.bcCampaigns())
  handle(C.bcCreateCampaign, (_e, i: unknown) => bc.bcCreateCampaign(i))
  handle(C.bcPreviewCampaign, (_e, id: unknown) => bc.bcPreviewCampaign(id))
  handle(C.bcStartCampaign, (_e, id: unknown, t: unknown) => bc.bcStartCampaign(id, t))
  handle(C.bcPauseCampaign, (_e, id: unknown) => bc.bcPauseCampaign(id))
  handle(C.bcResumeCampaign, (_e, id: unknown) => bc.bcResumeCampaign(id))
  handle(C.bcStopCampaign, (_e, id: unknown) => bc.bcStopCampaign(id))
  handle(C.bcDiscardDraft, (_e, id: unknown) => bc.bcDiscardDraft(id))
  handle(C.bcStopAll, () => bc.bcStopAll())
  handle(C.bcGetSafety, () => bc.bcGetSafety())
  handle(C.bcSetSafety, (_e, p: unknown) => bc.bcSetSafety(p))
  handle(C.bcReport, (_e, id: unknown) => bc.bcReport(id))
  handle(C.bcExportReport, (_e, id: unknown) => bc.bcExportReport(id))
  handle(C.bcEraseContact, (_e, id: unknown) => bc.bcEraseContact(id))
  handle(C.bcAddContact, (_e, i: unknown) => bc.bcAddContact(i))
  handle(C.listChats, () => d.feed.chats())
  handle(C.getThread, (_e, chatId: unknown) => d.feed.thread(ChatIdSchema.parse(chatId)))
  handle(C.getDashboard, () => buildDashboard(d.db, Date.now()))

  const a = d.auth
  handle(C.authState, () => a.authState())
  handle(C.authLogin, (_e, u: unknown, p: unknown) => a.authLogin(u, p))
  handle(C.authLock, () => a.authLock())
  handle(C.authSetup, (_e, u: unknown, p: unknown) => a.authSetup(u, p))
  handle(C.authChangePassword, (_e, o: unknown, n: unknown) => a.authChangePassword(o, n))
  handle(C.authReset, (_e, c: unknown, n: unknown) => a.authReset(c, n))
  handle(C.authDisable, (_e, p: unknown) => a.authDisable(p))
  handle(C.authSetAutoLock, (_e, m: unknown) => a.authSetAutoLock(m))
}

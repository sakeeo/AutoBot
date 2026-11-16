import { app, BrowserWindow, Menu, Notification, safeStorage } from 'electron'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import pino from 'pino'
import { openDb } from './db'
import { SafeStorageSecretStore, SettingsStore } from './settings'
import { IndexStore } from './knowledge/index-store'
import { Indexer } from './knowledge/indexer'
import { ReplyPipeline } from './pipeline/reply-pipeline'
import { BaileysGateway } from './wa/baileys-gateway'
import { ConversationStore } from './conversation/store'
import { HandoffService } from './conversation/handoff'
import { BrandStore } from './brand-store'
import { CatalogStore, parseCatalog } from './catalog/catalog-store'
import { ConversationAgent } from './pipeline/conversation-agent'
import type { AiProvider } from './answer/ai-answerer'
import { makeProvider } from './answer/make-provider'
import { secretNameFor } from '../shared/providers'
import { registerIpc } from './ipc'
import { createBrandHandlers } from './brand-ipc'
import { MessageFeed } from './messages/message-feed'
import { incomingNotification } from './notify'
import { BroadcastStore } from './broadcast/store'
import { BroadcastEngine } from './broadcast/engine'
import { ImportService } from './broadcast/import'
import { OptOutHandler } from './broadcast/optout-handler'
import { createBroadcastHandlers, loadSafety } from './broadcast/ipc'
import { syncChatContacts } from './broadcast/audience'
import { normalizePhone } from './broadcast/identity'
import { AuthStore } from './auth/auth-store'
import { createAuthHandlers, lockAwareSend, redactWhenLocked, type AuthHandlers } from './auth/auth-ipc'
import { createTray } from './tray'
import { CHANNELS as C } from '../shared/channels'
import type { ConnStatus } from '../shared/types'

let win: BrowserWindow | null = null
let quitting = false
let trayActive = false
let authHandlers: AuthHandlers | null = null

function showWindow(): void {
  if (!win || win.isDestroyed()) win = createWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 860,
    title: 'WA Otomation',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged
    }
  })
  // Any window created later (second launch after closing without a tray) must start locked too.
  authHandlers?.lock()
  // No File/Edit/Window menu bar on any platform; the page has its own navigation.
  w.removeMenu()
  w.setMenuBarVisibility(false)
  // Without the menu there are no accelerators, so development keeps DevTools on F12 / Ctrl+Shift+I.
  if (!app.isPackaged)
    w.webContents.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toUpperCase() === 'I'))) {
        e.preventDefault()
        w.webContents.toggleDevTools()
      }
    })
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  w.webContents.on('will-navigate', (e) => e.preventDefault())
  if (process.env['ELECTRON_RENDERER_URL']) w.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else w.loadFile(join(__dirname, '../renderer/index.html'))
  // With a tray, closing the window keeps the bot running in the background.
  w.on('close', (e) => {
    if (!quitting && trayActive) {
      e.preventDefault()
      w.hide()
    }
  })
  // A hidden window (closed to the tray) must be unlocked again; the bot keeps running regardless.
  w.on('hide', () => authHandlers?.lock())
  w.on('closed', () => { win = null })
  return w
}

function boot(): void {
  const data = app.getPath('userData')
  const logger = pino({ level: 'info' })
  const db = openDb(join(data, 'wa-otomation.db'))
  const settings = new SettingsStore(join(data, 'settings.json'))
  const secrets = new SafeStorageSecretStore(join(data, 'secrets.json'), safeStorage)
  const store = new IndexStore(db)
  const catalog = new CatalogStore(db)
  const isCatalogFile = (file: string): boolean => ['katalog.csv', 'katalog.json'].includes(basename(file).toLowerCase())
  const indexer = new Indexer(store, {
    onDocument: (file, raw, ext) => {
      if (!isCatalogFile(file)) return
      const { products, errors } = parseCatalog(raw, ext as '.csv' | '.json')
      catalog.replaceFromFile(file, products)
      for (const e of errors) logger.warn({ file }, `katalog: ${e}`)
    },
    onRemove: (file) => { if (isCatalogFile(file)) catalog.removeFile(file) }
  })
  const sessionDir = join(data, 'sessions', 'default')
  const gateway = new BaileysGateway({ sessionDir, logger: logger.child({ mod: 'baileys' }, { level: 'warn' }) })

  let providerCache: { id: string; provider: AiProvider } | null = null
  const currentProvider = (): AiProvider | null => {
    const ai = settings.get().ai
    const key = secrets.get(secretNameFor(ai.provider))
    if (!key) return null
    const id = JSON.stringify([ai.provider, ai.baseUrl ?? '', key])
    if (providerCache?.id !== id) providerCache = { id, provider: makeProvider(ai, key) }
    return providerCache.provider
  }

  const clock = { now: () => Date.now() }
  const conv = new ConversationStore(db, clock)
  const brandStore = new BrandStore(db, clock, () => ({
    botNumber: gateway.selfNumber(),
    productCount: catalog.list().length
  }))
  const handoff = new HandoffService({ gateway, conv, clock })
  const agent = new ConversationAgent({ store, catalog, conv, handoff, gateway, clock })

  const feed = new MessageFeed(db, clock)
  const bstore = new BroadcastStore(db, clock)
  let engine!: BroadcastEngine
  const optOut = new OptOutHandler({
    store: bstore, clock,
    wasBroadcastTo: (k) => bstore.wasSentTo(k),
    reply: (chatId, text) => pipeline.reply(chatId, text),
    isHumanHandling: (chatId) => conv.getState(chatId).status === 'manusia',
    onSignal: (k) => engine.onSignal(k)
  })
  const pipeline = new ReplyPipeline({
    gateway, store, settings, db,
    ai: currentProvider,
    clock,
    rand: Math.random,
    conv,
    brand: () => brandStore.getActive(),
    agent,
    feed,
    optOut
  })

  let status: ConnStatus = { state: 'disconnected' }
  engine = new BroadcastEngine({
    store: bstore, gateway, feed, conv, clock, rand: Math.random,
    isBusy: () => pipeline.busy(),
    connected: () => status.state === 'connected',
    settings: () => loadSafety(bstore, Date.now()),
    businessName: () => brandStore.getActive().identity.businessName.trim() || 'kami'
  })
  // People who must never receive a broadcast: the admins and the bot's own number.
  const protectNumbers = (): void => {
    for (const a of brandStore.getActive().admins) bstore.suppress({ number: normalizePhone(a.number), reason: 'admin' })
    const me = gateway.selfNumber()
    if (me) bstore.suppress({ number: me, reason: 'admin' })
  }
  const rawSend = (channel: string, payload: unknown): void => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }
  const isLocked = (): boolean => authHandlers?.isLocked() ?? false
  // While locked, only the lock event may reach the window; data events would leak to DevTools or the lock screen.
  const send = lockAwareSend(isLocked, rawSend)
  const tray = createTray({ iconPath: join(__dirname, '../../resources/tray.png'), showWindow })
  trayActive = tray !== null
  const STATUS_LABEL: Record<ConnStatus['state'], string> = {
    disconnected: 'Terputus',
    connecting: 'Menghubungkan…',
    waiting_qr: 'Menunggu scan QR',
    connected: 'Terhubung'
  }
  gateway.onStatus((s) => {
    status = s
    if (s.state === 'connected') protectNumbers()
    send(C.evtStatus, s)
    tray?.refresh(STATUS_LABEL[s.state])
  })
  feed.on('message', (m) => {
    send(C.evtMessage, m)
    try {
      const n = incomingNotification(m, { enabled: settings.get().notifyIncoming, locked: isLocked(), now: Date.now() })
      if (n && Notification.isSupported()) {
        const note = new Notification(n)
        note.on('click', showWindow)
        note.show()
      }
    } catch (e) {
      logger.warn({ err: e }, 'notification failed')
    }
  })
  indexer.on('status', (e) => send(C.evtIndexStatus, e))
  pipeline.on('escalate', (m: { chatId: string; text: string | null }) => {
    send(C.evtEscalate, { chatId: m.chatId, text: m.text })
    if (Notification.isSupported())
      new Notification({ title: 'Perlu dibalas manual', body: redactWhenLocked(isLocked, (m.text ?? '').slice(0, 120), 'Ada pesan yang perlu dibalas') }).show()
  })
  handoff.on('handoff', (e: { chatId: string; reason: string; summary: string }) => {
    send(C.evtHandoff, { chatId: e.chatId, reason: e.reason, summary: e.summary })
    if (Notification.isSupported())
      new Notification({ title: 'Pelanggan diserahkan ke admin', body: redactWhenLocked(isLocked, `${e.chatId.split('@')[0]} · ${e.reason}`, 'Buka aplikasi untuk melihat detail') }).show()
  })
  pipeline.on('feed_error', (e) => logger.warn({ err: e }, 'message feed failed'))
  engine.on('progress', (e: { campaignId: number; antre: number; terkirim: number; gagal: number; dilewati: number }) =>
    send(C.evtBroadcast, { type: 'progress', campaignId: e.campaignId, progress: { antre: e.antre, terkirim: e.terkirim, gagal: e.gagal, dilewati: e.dilewati } }))
  engine.on('done', (e: { campaignId: number }) => send(C.evtBroadcast, { type: 'done', campaignId: e.campaignId }))
  engine.on('paused', (e: { campaignId: number; reason: string }) => {
    send(C.evtBroadcast, { type: 'paused', campaignId: e.campaignId, reason: e.reason })
    try {
      if (Notification.isSupported())
        new Notification({ title: 'Broadcast dijeda', body: redactWhenLocked(isLocked, e.reason, 'Buka aplikasi untuk melihat alasannya') }).show()
    } catch (err) {
      logger.warn({ err }, 'broadcast notification failed')
    }
  })
  engine.on('engine_error', (err) => logger.warn({ err }, 'broadcast engine failed'))
  // Anything that was running when the app last closed comes back paused, never silently resumed.
  engine.resetAfterRestart()
  engine.startTimer()
  protectNumbers()
  const syncAudience = (): void => {
    try { syncChatContacts(db, bstore, Date.now()) } catch (err) { logger.warn({ err }, 'broadcast audience sync failed') }
  }
  syncAudience()
  setInterval(syncAudience, 10 * 60_000)
  pipeline.start()

  const restartIndexer = (): void => {
    const s = settings.get()
    indexer.start(s.knowledgeFolders, s.excludePatterns).catch((e) => logger.error(e))
  }
  restartIndexer()

  const brandHandlers = createBrandHandlers({
    brand: brandStore, catalog, store, gateway, clock,
    getProvider: () => {
      const provider = currentProvider()
      if (!provider) return null
      const { model, maxTokens } = settings.get().ai
      return { provider, cfg: { model, maxTokens } }
    }
  })

  authHandlers = createAuthHandlers(
    new AuthStore(join(data, 'auth.json'), clock, (msg) => logger.warn(msg)),
    () => rawSend(C.evtAuthLocked, null)
  )

  const importer = new ImportService({ store: bstore, gateway, clock, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) })
  const broadcast = createBroadcastHandlers({
    store: bstore, engine, importer, clock, isLocked,
    businessName: () => brandStore.getActive().identity.businessName.trim() || 'kami'
  })

  registerIpc({
    broadcast,
    brandHandlers,
    auth: authHandlers,
    feed,
    gateway, getStatus: () => status, indexer, store, settings, secrets, pipeline, db, makeProvider,
    getWindow: () => win,
    onSettingsChanged: (prev, next) => {
      const key = (x: typeof prev): string => JSON.stringify([x.knowledgeFolders, x.excludePatterns])
      if (key(prev) !== key(next)) restartIndexer()
      if (prev.autoStart !== next.autoStart) app.setLoginItemSettings({ openAtLogin: next.autoStart })
    }
  })
  app.setLoginItemSettings({ openAtLogin: settings.get().autoStart })

  // Resume the previous WhatsApp session automatically.
  if (existsSync(join(sessionDir, 'creds.json'))) gateway.connect().catch((e) => logger.error(e))
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
  app.on('before-quit', () => { quitting = true })
  app.whenReady().then(() => {
    // macOS always has a menu bar; keep only the app and Edit roles there so Cmd+Q / Cmd+C / Cmd+V keep working.
    Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]) : null)
    boot()
    win = createWindow()
  })
  app.on('window-all-closed', () => {
    if (!trayActive && process.platform !== 'darwin') app.quit()
  })
}

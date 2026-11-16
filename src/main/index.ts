import { app, BrowserWindow, Notification, safeStorage } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import pino from 'pino'
import { openDb } from './db'
import { SafeStorageSecretStore, SettingsStore } from './settings'
import { IndexStore } from './knowledge/index-store'
import { Indexer } from './knowledge/indexer'
import { ReplyPipeline } from './pipeline/reply-pipeline'
import { BaileysGateway } from './wa/baileys-gateway'
import type { AiProvider } from './answer/ai-answerer'
import { makeProvider } from './answer/make-provider'
import { secretNameFor } from '../shared/providers'
import { registerIpc } from './ipc'
import { createTray } from './tray'
import { CHANNELS as C } from '../shared/channels'
import type { ConnStatus } from '../shared/types'

let win: BrowserWindow | null = null
let quitting = false
let trayActive = false

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
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
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
  const indexer = new Indexer(store)
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

  const pipeline = new ReplyPipeline({
    gateway, store, settings, db,
    ai: currentProvider,
    clock: { now: () => Date.now() },
    rand: Math.random
  })

  let status: ConnStatus = { state: 'disconnected' }
  const send = (channel: string, payload: unknown): void => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }
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
    send(C.evtStatus, s)
    tray?.refresh(STATUS_LABEL[s.state])
  })
  indexer.on('status', (e) => send(C.evtIndexStatus, e))
  pipeline.on('escalate', (m: { chatId: string; text: string | null }) => {
    send(C.evtEscalate, { chatId: m.chatId, text: m.text })
    if (Notification.isSupported())
      new Notification({ title: 'Perlu dibalas manual', body: (m.text ?? '').slice(0, 120) }).show()
  })
  pipeline.start()

  const restartIndexer = (): void => {
    const s = settings.get()
    indexer.start(s.knowledgeFolders, s.excludePatterns).catch((e) => logger.error(e))
  }
  restartIndexer()

  registerIpc({
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
    boot()
    win = createWindow()
  })
  app.on('window-all-closed', () => {
    if (!trayActive && process.platform !== 'darwin') app.quit()
  })
}

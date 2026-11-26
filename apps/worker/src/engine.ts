import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import pino from 'pino'
import { CHANNELS as C } from '@autobot/contracts/channels'
import { secretNameFor } from '@autobot/contracts/providers'
import type { ConnStatus } from '@autobot/contracts/types'
import { openDb, type Db } from './db'
import { AesGcmSecretStore, SettingsStore } from './settings'
import { IndexStore } from './knowledge/index-store'
import { Indexer } from './knowledge/indexer'
import { resolveKnownFile, saveUploads } from './knowledge/files'
import { ReplyPipeline } from './pipeline/reply-pipeline'
import { BaileysGateway } from './wa/baileys-gateway'
import type { WaGateway } from './wa/gateway'
import { ConversationStore } from './conversation/store'
import { HandoffService } from './conversation/handoff'
import { BrandStore } from './brand-store'
import { CatalogStore, parseCatalog } from './catalog/catalog-store'
import { ConversationAgent } from './pipeline/conversation-agent'
import type { AiProvider } from './answer/ai-answerer'
import { makeProvider } from './answer/make-provider'
import { createBrandHandlers, SilentGateway } from './brand-ipc'
import { MessageFeed } from './messages/message-feed'
import { buildRpc, type RpcHandlers } from './rpc'
import { InstanceMeta } from './instance-meta'
import { acquireInstanceLock, type InstanceLock } from './instance-lock'
import { UserError } from './errors'
import { GoogleAuth } from './knowledge/gsheets/auth'
import { SheetsClient } from './knowledge/gsheets/client'
import { createGsHandlers, readKey } from './knowledge/gsheets/handlers'
import { SourceStore } from './knowledge/gsheets/source-store'
import { ClockMonitor, type ClockReport, type TimeProbe } from './clock-monitor'
import { SheetSyncService } from './knowledge/gsheets/sync'
import type { SheetsSource } from './knowledge/gsheets/client'
import { SystemSender, type SystemSendRequest, type SystemSendResult } from './system-send'

export interface EngineConfig {
  /** Everything the engine stores lives under this folder (database, WhatsApp session, knowledge, secrets). */
  dataDir: string
  /** 32-byte key that encrypts API keys and other secrets. Comes from the deployment, never from the data folder. */
  secretKey: Buffer
  logger?: pino.Logger
  /** Tests pass a fake gateway; production uses Baileys. */
  gateway?: WaGateway
  clock?: { now(): number }
  /** Tests that open several engines on different folders do not need the single-instance lock. */
  skipInstanceLock?: boolean
  /** Tests pass a fake Google Sheets source; production talks to Google. */
  sheetsSource?: SheetsSource
  /** Tests that do not exercise Sheets keep the scheduler off. */
  disableSheetsSchedule?: boolean
  /** Reads a trusted remote clock; when given, /health reports clock skew (TOTP breaks when the clock drifts). */
  timeProbe?: TimeProbe
}

export interface EngineHealth {
  ok: boolean
  wa: ConnStatus['state']
  botEnabled: boolean
  schemaVersion: number
  knowledgeFiles: number
  clock: ClockReport
}

export interface Engine {
  /** The methods the browser may call, by name (see CHANNELS). Each validates its own arguments. */
  rpc: RpcHandlers
  /** Emits CHANNELS.evt* events (status, message, index status, escalation, handoff). */
  events: EventEmitter
  /** Sends a verification code or a notice to the owner; leaves no trace in the conversation. */
  systemSend(req: SystemSendRequest): Promise<SystemSendResult>
  /** Saves uploaded knowledge files and indexes them. */
  uploadKnowledge(files: { name: string; data: Buffer }[]): Promise<{ added: string[]; rejected: { name: string; reason: string }[] }>
  /** Absolute path of an indexed knowledge file by its name inside the knowledge folder; throws a NOT_FOUND UserError otherwise. */
  knowledgeFilePath(name: string): string
  health(): EngineHealth
  /** Resolves when the first scan of the knowledge folder is done. */
  ready: Promise<void>
  /** Internals for tests and for modules built on top (Google Sheets sync). */
  internals: { db: Db; indexer: Indexer; settings: SettingsStore; secrets: AesGcmSecretStore; gateway: WaGateway; meta: InstanceMeta; pipeline: ReplyPipeline; conv: ConversationStore; knowledgeDir: string; clock: { now(): number }; sheetSync: SheetSyncService }
  shutdown(): Promise<void>
}

const isCatalogFile = (file: string): boolean => ['katalog.csv', 'katalog.json'].includes(basename(file).toLowerCase())

/** Never let a secret, a code or a customer's text reach the log, even by accident. */
const REDACT = ['otp', 'code', 'text', 'password', 'apiKey', 'secret', 'token', '*.otp', '*.code', '*.text', '*.password', '*.apiKey', '*.secret', '*.token']

export async function createEngine(cfg: EngineConfig): Promise<Engine> {
  const logger = cfg.logger ?? pino({ level: process.env.LOG_LEVEL ?? 'info', redact: { paths: REDACT, censor: '[redacted]' } })
  const clock = cfg.clock ?? { now: () => Date.now() }
  mkdirSync(cfg.dataDir, { recursive: true, mode: 0o700 })
  const lock: InstanceLock | null = cfg.skipInstanceLock ? null : acquireInstanceLock(join(cfg.dataDir, 'instance.lock'))

  try {
    const knowledgeDir = join(cfg.dataDir, 'knowledge')
    const sessionDir = join(cfg.dataDir, 'sessions', 'default')
    const db = openDb(join(cfg.dataDir, 'autobot.db'))
    const settings = new SettingsStore(join(cfg.dataDir, 'settings.json'))
    const secrets = new AesGcmSecretStore(join(cfg.dataDir, 'secrets.json'), cfg.secretKey)
    const meta = new InstanceMeta(db)
    const store = new IndexStore(db)
    const catalog = new CatalogStore(db)
    const events = new EventEmitter()

    const indexer = new Indexer(store, {
      root: knowledgeDir,
      onDocument: (file, raw, ext) => {
        if (!isCatalogFile(file)) return
        const { products, errors } = parseCatalog(raw, ext as '.csv' | '.json')
        catalog.replaceFromFile(file, products)
        for (const e of errors) logger.warn({ file }, `katalog: ${e}`)
      },
      onRemove: (file) => { if (isCatalogFile(file)) catalog.removeFile(file) }
    })
    const gateway = cfg.gateway ?? new BaileysGateway({ sessionDir, logger: logger.child({ mod: 'baileys' }, { level: 'warn' }) })

    let providerCache: { id: string; provider: AiProvider } | null = null
    const currentProvider = (): AiProvider | null => {
      const ai = settings.get().ai
      const key = secrets.get(secretNameFor(ai.provider))
      if (!key) return null
      const id = JSON.stringify([ai.provider, ai.baseUrl ?? '', key])
      if (providerCache?.id !== id) providerCache = { id, provider: makeProvider(ai, key) }
      return providerCache.provider
    }

    const conv = new ConversationStore(db, clock)
    const brandStore = new BrandStore(db, clock, () => ({
      botNumber: gateway.selfNumber(),
      productCount: catalog.list().length
    }))
    const handoff = new HandoffService({ gateway, conv, clock })
    const agent = new ConversationAgent({ store, catalog, conv, handoff, gateway, clock })
    const feed = new MessageFeed(db, clock)
    // The test chat replays its earlier turns into a throwaway store: nothing is saved and nobody is contacted.
    const previewAgent = (history: { role: 'user' | 'bot'; text: string }[]): ConversationAgent => {
      const pconv = new ConversationStore(openDb(':memory:'), clock)
      for (const t of history) pconv.appendTurn('__preview__', t.role, t.text)
      const silent = new SilentGateway(gateway)
      return new ConversationAgent({ store, catalog, conv: pconv, handoff: new HandoffService({ gateway: silent, conv: pconv, clock }), gateway: silent, clock })
    }
    const pipeline = new ReplyPipeline({
      previewAgent,
      gateway, store, settings, db,
      ai: currentProvider,
      clock,
      rand: Math.random,
      conv,
      brand: () => brandStore.getActive(),
      agent,
      feed,
      botEnabled: () => meta.botEnabled()
    })

    let status: ConnStatus = { state: 'disconnected' }
    gateway.onStatus((s) => {
      status = s
      events.emit(C.evtStatus, s)
    })
    feed.on('message', (m) => events.emit(C.evtMessage, m))
    indexer.on('status', (e) => events.emit(C.evtIndexStatus, e))
    pipeline.on('escalate', (m: { chatId: string; text: string | null }) => events.emit(C.evtEscalate, { chatId: m.chatId, text: m.text }))
    handoff.on('handoff', (e: { chatId: string; reason: string; summary: string }) =>
      events.emit(C.evtHandoff, { chatId: e.chatId, reason: e.reason, summary: e.summary }))
    pipeline.on('feed_error', (e) => logger.warn({ err: e }, 'message feed failed'))
    pipeline.start()

    const brandHandlers = createBrandHandlers({
      brand: brandStore, catalog, store, gateway, clock,
      getProvider: () => {
        const provider = currentProvider()
        if (!provider) return null
        const { model, maxTokens } = settings.get().ai
        return { provider, cfg: { model, maxTokens } }
      }
    })

    const rpc = buildRpc({
      brandHandlers, feed, conv, gateway, getStatus: () => status, indexer, store, settings, secrets, pipeline, db,
      knowledgeDir, makeProvider, onSettingsChanged: () => undefined
    })
    const gsAuth = new GoogleAuth(() => readKey(secrets))
    const sheets = cfg.sheetsSource ?? new SheetsClient(gsAuth)
    const gsStore = new SourceStore(db)
    const gsSync = new SheetSyncService({
      store: gsStore, source: () => sheets, hasCredential: () => !!readKey(secrets), knowledgeDir, indexer, clock,
      log: (i) => logger.info(i, 'sheets sync')
    })
    gsSync.on('sync', (e) => events.emit(C.evtKnowledgeSync, e))
    Object.assign(rpc, createGsHandlers({ store: gsStore, sync: gsSync, secrets, meta, auth: gsAuth, source: () => sheets, clock }))
    if (!cfg.disableSheetsSchedule) gsSync.start()
    rpc.getSelfNumber = () => gateway.selfNumber()
    rpc.getBotEnabled = () => meta.botEnabled()
    rpc.setBotEnabled = (on: unknown) => {
      if (typeof on !== 'boolean') throw new UserError('Nilai harus true atau false.')
      meta.setBotEnabled(on)
      return meta.botEnabled()
    }

    const sender = new SystemSender({
      db, gateway, clock,
      isConnected: () => status.state === 'connected',
      deliver: (chatId, text) => pipeline.sendSystem(chatId, text),
      log: (info) => logger.info(info, 'system message')
    })

    const clockMonitor = new ClockMonitor(cfg.timeProbe ?? (async () => null), clock, (r) => {
      if (r.status === 'warn' || r.status === 'bad') logger.warn({ skewMs: r.skewMs }, 'system clock differs from network time; logins with a code may fail')
    })
    if (cfg.timeProbe) clockMonitor.start()

    const ready = indexer.start().catch((e) => { logger.error({ err: e }, 'knowledge scan failed') })

    // Resume the previous WhatsApp session automatically.
    if (existsSync(join(sessionDir, 'creds.json'))) gateway.connect().catch((e) => logger.error(e))

    return {
      rpc,
      events,
      systemSend: (req) => sender.send(req),
      async uploadKnowledge(files) {
        const res = await saveUploads(files, knowledgeDir)
        for (const name of res.added) await indexer.indexFile(join(knowledgeDir, name))
        return res
      },
      knowledgeFilePath: (name) => resolveKnownFile(resolve(knowledgeDir, name), [knowledgeDir], store),
      health: () => ({
        ok: true,
        wa: status.state,
        botEnabled: meta.botEnabled(),
        schemaVersion: db.pragma('user_version', { simple: true }) as number,
        knowledgeFiles: store.listFiles().length,
        clock: clockMonitor.current()
      }),
      ready,
      internals: { db, indexer, settings, secrets, gateway, meta, pipeline, conv, knowledgeDir, clock, sheetSync: gsSync },
      async shutdown() {
        clockMonitor.stop()
        await gsSync.stop()
        await indexer.stop()
        try { await gateway.stop?.() } catch (e) { logger.warn({ err: e }, 'gateway stop failed') }
        try { db.close() } catch { /* already closed */ }
        lock?.release()
      }
    }
  } catch (e) {
    lock?.release()
    throw e
  }
}

import { mkdirSync, rmSync } from 'node:fs'
import pino from 'pino'
import type { ConnStatus, IncomingMessage } from '../../shared/types'
import { normalizeNumber } from '../../shared/brand'
import type { WaGateway } from './gateway'

// Baileys is ESM-only; it is loaded with dynamic import() so the CJS main bundle can use it.
// Disconnect codes mirror Baileys' DisconnectReason.
const LOGGED_OUT = 401
const CONNECTION_REPLACED = 440

/** Loose shape of Baileys' WAMessage — only what we read. */
export interface RawWaMessage {
  key?: { id?: string | null; remoteJid?: string | null; fromMe?: boolean | null; participant?: string | null }
  message?: any
  messageTimestamp?: number | { toNumber(): number } | null
}

function unwrap(message: any): any {
  let m = message
  for (let i = 0; i < 5 && m; i++) {
    const inner =
      m.ephemeralMessage?.message ??
      m.viewOnceMessage?.message ??
      m.viewOnceMessageV2?.message ??
      m.documentWithCaptionMessage?.message
    if (!inner) break
    m = inner
  }
  return m
}

export function normalizeMessage(raw: RawWaMessage): IncomingMessage | null {
  const id = raw.key?.id
  if (!id || !raw.message) return null
  const chatId = raw.key?.remoteJid ?? ''
  const m = unwrap(raw.message)
  const text: string | null =
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    null
  const ts = raw.messageTimestamp
  const seconds = ts == null ? NaN : typeof ts === 'number' ? ts : Number(ts.toNumber?.() ?? ts)
  return {
    id,
    chatId,
    sender: raw.key?.participant ?? chatId,
    isGroup: chatId.endsWith('@g.us'),
    fromMe: !!raw.key?.fromMe,
    text,
    timestamp: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : Date.now()
  }
}

export function nextReconnect(
  code: number | undefined,
  attempt: number
): { reconnect: boolean; delayMs: number; clearSession: boolean } {
  if (code === LOGGED_OUT) return { reconnect: false, delayMs: 0, clearSession: true }
  if (code === CONNECTION_REPLACED) return { reconnect: false, delayMs: 0, clearSession: false }
  return { reconnect: true, delayMs: Math.min(1000 * 2 ** attempt, 60_000), clearSession: false }
}

/**
 * Live notifications are forwarded. Appended messages are forwarded only when we sent them
 * (a human typing from the phone), so the bot can notice a takeover; history sync never is.
 */
export function shouldHandleUpsert(type: string, fromMe = false): boolean {
  return type === 'notify' || (type === 'append' && fromMe)
}

/** "6285119308345:12@s.whatsapp.net" -> "6285119308345". */
export function selfNumberFromJid(jid: string | null | undefined): string | null {
  if (!jid) return null
  const digits = jid.split('@')[0].split(':')[0].replace(/\D/g, '')
  return digits || null
}

export function jidForNumber(number: string): string {
  return `${normalizeNumber(number)}@s.whatsapp.net`
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export class BaileysGateway implements WaGateway {
  private sock: any = null
  private msgCbs: ((m: IncomingMessage) => void)[] = []
  private statusCbs: ((s: ConnStatus) => void)[] = []
  private attempt = 0
  private stopped = false
  private timer: NodeJS.Timeout | null = null
  private logger: pino.Logger

  constructor(private opts: { sessionDir: string; logger?: pino.Logger }) {
    this.logger = opts.logger ?? pino({ level: 'silent' })
  }

  onMessage(cb: (m: IncomingMessage) => void): void { this.msgCbs.push(cb) }
  onStatus(cb: (s: ConnStatus) => void): void { this.statusCbs.push(cb) }
  private emit(s: ConnStatus): void { for (const cb of this.statusCbs) cb(s) }

  async connect(): Promise<void> {
    this.stopped = false
    await this.open()
  }

  private async open(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.emit({ state: 'connecting' })
    const baileys: any = await import('@whiskeysockets/baileys')
    const makeWASocket = baileys.default ?? baileys.makeWASocket
    mkdirSync(this.opts.sessionDir, { recursive: true })
    const { state, saveCreds } = await baileys.useMultiFileAuthState(this.opts.sessionDir)
    const latest = await baileys.fetchLatestBaileysVersion().catch(() => undefined)
    const sock = makeWASocket({
      auth: state,
      version: latest?.version,
      logger: this.logger,
      markOnlineOnConnect: false,
      syncFullHistory: false
    })
    this.sock = sock
    sock.ev.on('creds.update', saveCreds)
    sock.ev.on('connection.update', (u: any) => {
      if (u.qr) this.emit({ state: 'waiting_qr', qr: u.qr })
      if (u.connection === 'open') {
        this.attempt = 0
        this.emit({ state: 'connected' })
      }
      if (u.connection === 'close') {
        const code: number | undefined = u.lastDisconnect?.error?.output?.statusCode
        const plan = nextReconnect(code, this.attempt)
        this.emit({ state: 'disconnected' })
        if (plan.clearSession) rmSync(this.opts.sessionDir, { recursive: true, force: true })
        if (plan.reconnect && !this.stopped) {
          this.attempt++
          this.timer = setTimeout(() => {
            this.open().catch((e) => this.logger.error(e))
          }, plan.delayMs)
        }
      }
    })
    sock.ev.on('messages.upsert', ({ messages, type }: { messages: RawWaMessage[]; type: string }) => {
      for (const raw of messages) {
        if (!shouldHandleUpsert(type, !!raw.key?.fromMe)) continue
        const m = normalizeMessage(raw)
        if (m) for (const cb of this.msgCbs) cb(m)
      }
    })
  }

  selfNumber(): string | null {
    return selfNumberFromJid(this.sock?.user?.id)
  }

  jidFor(number: string): string {
    return jidForNumber(number)
  }

  async sendText(chatId: string, text: string, opts: { typingMs?: number } = {}): Promise<string | null> {
    if (!this.sock) throw new Error('WhatsApp not connected')
    try {
      await this.sock.sendPresenceUpdate('composing', chatId)
      if (opts.typingMs) await sleep(opts.typingMs)
      const sent = await this.sock.sendMessage(chatId, { text })
      return sent?.key?.id ?? null
    } finally {
      await this.sock.sendPresenceUpdate('paused', chatId).catch(() => undefined)
    }
  }

  async logout(): Promise<void> {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    try {
      await this.sock?.logout()
    } catch {
      /* already closed */
    }
    this.sock = null
    rmSync(this.opts.sessionDir, { recursive: true, force: true })
    this.emit({ state: 'disconnected' })
  }
}

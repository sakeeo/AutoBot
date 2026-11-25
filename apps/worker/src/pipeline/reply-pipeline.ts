import { EventEmitter } from 'node:events'
import type { Db } from '../db'
import type { IndexStore } from '../knowledge/index-store'
import type { SettingsStore } from '../settings'
import type { WaGateway } from '../wa/gateway'
import type { Answer, Decision, IncomingMessage } from '@autobot/contracts/types'
import { decide } from '../answer/gate'
import { buildExtractiveAnswer } from '../answer/extractive'
import type { AiProvider } from '../answer/ai-answerer'
import type { ConversationStore } from '../conversation/store'
import { splitBubbles, typingMsFor } from '../conversation/bubbles'
import type { ConversationAgent, AgentTurnResult } from './conversation-agent'
import type { MessageFeed } from '../messages/message-feed'
import type { BrandProfile } from '@autobot/contracts/brand'
import type { Settings } from '@autobot/contracts/types'

export type PipelineResult =
  | {
      kind: 'ignored'
      why: 'from_me' | 'no_text' | 'group' | 'status' | 'stale' | 'duplicate' | 'cooldown' | 'human' | 'rate_limit' | 'bot_off' | 'self'
    }
  | { kind: 'replied'; sources: string[]; via: 'extractive' | 'ai'; linkSent?: string | null }
  | { kind: 'out_of_context'; action: 'reply' | 'silent' | 'escalate' }
  | { kind: 'handoff'; reason: string }
  | { kind: 'error'; message: string }

export interface PipelineDeps {
  gateway: WaGateway
  store: IndexStore
  settings: SettingsStore
  db: Db
  ai: () => AiProvider | null
  clock: { now(): number }
  rand: () => number
  conv: ConversationStore
  brand: () => BrandProfile
  agent: ConversationAgent
  /** Records and announces every message; optional so older wiring and tests keep working. */
  feed?: MessageFeed
  /** Whether the owner has switched the bot on. Absent means always on (older wiring and tests). */
  botEnabled?: () => boolean
}

/** Thrown right before sending when a human took over the chat while the answer was being prepared. */
class PausedError extends Error {}

const STALE_MS = 2 * 60_000
const TYPING_MIN_MS = 2000
const TYPING_SPAN_MS = 4000
const TOP_K = 5

export class ReplyPipeline extends EventEmitter {
  private chains = new Map<string, Promise<unknown>>()
  /** Own (fromMe) messages that arrived while a send to that chat was in flight. */
  private inflight = new Map<string, IncomingMessage[]>()

  constructor(private d: PipelineDeps) {
    super()
  }

  start(): void {
    this.d.gateway.onMessage((m) => {
      this.handle(m).catch(() => undefined)
    })
  }

  /** Handles one message. Messages of the same chat are processed strictly one after another. */
  handle(m: IncomingMessage): Promise<PipelineResult> {
    // The chat with our own number ("message yourself") is never a customer: not recorded, not answered, never a takeover.
    if (this.isSelfChat(m.chatId)) return Promise.resolve({ kind: 'ignored', why: 'self' })
    // Our own messages never wait behind a customer message: a human may type while the bot is still composing.
    if (m.fromMe) return Promise.resolve(this.handleOwn(m))
    this.record(() => this.d.feed?.recordIncoming(m))
    const prev = this.chains.get(m.chatId) ?? Promise.resolve()
    const next = prev.then(() => this.run(m))
    const tail = next.catch(() => undefined)
    this.chains.set(m.chatId, tail)
    void tail.then(() => {
      if (this.chains.get(m.chatId) === tail) this.chains.delete(m.chatId)
    })
    return next
  }

  private isSelfChat(chatId: string): boolean {
    const self = this.d.gateway.selfNumber()
    return !!self && chatId.split('@')[0].split(':')[0] === self
  }

  /** The feed is a view of the conversation; whatever goes wrong in it must never change what the bot does. */
  private record(fn: () => unknown): void {
    try {
      fn()
    } catch (e) {
      this.emit('feed_error', e)
    }
  }

  /** A message sent from this account: the bot's own echo, or a human typing from the phone. */
  private handleOwn(m: IncomingMessage): PipelineResult {
    const ignored: PipelineResult = { kind: 'ignored', why: 'from_me' }
    if (m.isGroup || m.chatId.endsWith('@broadcast')) return ignored
    if (this.d.conv.isSentId(m.id)) return ignored
    const pending = this.inflight.get(m.chatId)
    if (pending) {
      // Could be the echo of the message being sent right now; decided once sendText returns its id.
      pending.push(m)
      return ignored
    }
    this.takeover(m)
    return ignored
  }

  private takeover(m: IncomingMessage): void {
    // A person who took the chat over from the app stays in charge with no time limit; typing on the phone must not shorten that.
    if (!this.d.conv.isTakenOver(m.chatId)) this.d.conv.pauseFor(m.chatId, 'manusia', this.d.brand().limits.pauseHours)
    this.d.conv.appendTurn(m.chatId, 'admin', m.text ?? '(pesan non-teks)')
    this.record(() => this.d.feed?.recordHuman(m))
  }

  private async run(m: IncomingMessage): Promise<PipelineResult> {
    // Before the owner switches the bot on (and whenever it is off) nothing is answered and nothing is claimed in the log.
    if (this.d.botEnabled && !this.d.botEnabled()) return { kind: 'ignored', why: 'bot_off' }
    // Claim the id first so a crash or restart can never produce a second reply.
    const claimed = this.d.db
      .prepare(
        `INSERT OR IGNORE INTO message_log(message_id, chat_id, decision, created_at, text)
         VALUES (?, ?, 'pending', ?, ?)`
      )
      .run(m.id, m.chatId, this.d.clock.now(), m.text)
    if (claimed.changes === 0) return { kind: 'ignored', why: 'duplicate' }

    let result: PipelineResult
    let top: number | null = null
    let sources: string[] = []
    try {
      const out = await this.process(m)
      result = out.result
      top = out.top
      sources = out.sources
    } catch (e) {
      result =
        e instanceof PausedError
          ? { kind: 'ignored', why: 'human' }
          : { kind: 'error', message: (e as Error).message }
    }
    this.d.db
      .prepare('UPDATE message_log SET decision = ?, top_score = ?, sources = ? WHERE message_id = ?')
      .run(describe(result), top, JSON.stringify(sources), m.id)
    return result
  }

  private async process(m: IncomingMessage): Promise<{ result: PipelineResult; top: number | null; sources: string[] }> {
    const s = this.d.settings.get()
    const ignored = (why: Extract<PipelineResult, { kind: 'ignored' }>['why']) => ({
      result: { kind: 'ignored', why } as PipelineResult,
      top: null,
      sources: [] as string[]
    })

    if (m.chatId.endsWith('@broadcast')) return ignored('status')
    if (m.text === null || m.text.trim() === '') return ignored('no_text')
    if (m.isGroup && !s.allowGroups) return ignored('group')
    const paused = this.d.conv.isPaused(m.chatId)
    // While a person (or an admin handoff) holds the chat the bot stays quiet, but it still reads along: the customer's
    // message goes into the conversation history so the bot understands the thread when it is handed back.
    // (The message id was claimed before this point, so a redelivery cannot be recorded twice.)
    if (paused) this.d.conv.appendTurn(m.chatId, 'user', m.text.trim() === '' ? '(pesan non-teks)' : m.text)
    if (this.d.clock.now() - m.timestamp > STALE_MS) return ignored('stale')
    if (paused) return ignored('human')

    // AI mode: the conversation agent answers. It has no per-contact cooldown (customers send several
    // short messages in a row) but is held to an hourly reply limit.
    const provider = s.mode === 'ai' ? this.d.ai() : null
    if (provider) return this.processAgent(m, s, provider)

    const cd = this.d.db.prepare('SELECT last_at FROM cooldowns WHERE chat_id = ?').get(m.chatId) as
      | { last_at: number }
      | undefined
    if (cd && this.d.clock.now() - cd.last_at < s.cooldownSec * 1000) return ignored('cooldown')

    const hits = this.d.store.search(m.text, TOP_K)
    const top = hits[0]?.coverage ?? null
    const decision = decide(m.text, hits, s.threshold)

    // Greetings, thanks and emoji carry no question: never answer them with a refusal.
    if (decision.kind === 'out_of_context' && decision.reason === 'no_tokens')
      return { result: { kind: 'out_of_context', action: 'silent' }, top, sources: [] }
    if (decision.kind === 'out_of_context') return this.outOfContext(m, top)

    const answer = buildExtractiveAnswer(m.text, decision.hits)
    await this.send(m.chatId, answer.text)
    return { result: { kind: 'replied', sources: answer.sources, via: 'extractive' }, top, sources: answer.sources }
  }

  private async processAgent(
    m: IncomingMessage,
    s: Settings,
    provider: AiProvider
  ): Promise<{ result: PipelineResult; top: number | null; sources: string[] }> {
    const profile = this.d.brand()
    const now = this.d.clock.now()
    if (this.d.conv.countRepliesSince(m.chatId, now - 3_600_000) >= profile.limits.maxRepliesPerHour)
      return { result: { kind: 'ignored', why: 'rate_limit' }, top: null, sources: [] }

    const r = await this.d.agent.handleTurn({
      chatId: m.chatId, text: m.text ?? '', profile, provider, cfg: s.ai, dryRun: false, memory: s.memoryEnabled
    })
    const bubbles = splitBubbles(r.replyParts)
    for (const b of bubbles) await this.send(m.chatId, b, typingMsFor(b, this.d.rand))
    // The customer already has their answer; writing the summary happens afterwards and can never delay or break it.
    if (s.memoryEnabled) void this.d.agent.maybeFold({ chatId: m.chatId, provider, cfg: s.ai }).catch(() => undefined)

    const top = r.hits[0]?.coverage ?? null
    if (r.handoff) return { result: { kind: 'handoff', reason: r.handoff.reason }, top, sources: r.sources }
    if (bubbles.length === 0) return { result: { kind: 'out_of_context', action: 'silent' }, top, sources: [] }
    if (r.intent === 'di_luar_konteks') return { result: { kind: 'out_of_context', action: 'reply' }, top, sources: [] }
    return { result: { kind: 'replied', sources: r.sources, via: 'ai', linkSent: r.linkSent }, top, sources: r.sources }
  }

  /** Dry run for the "Uji Jawaban" panel: same retrieval, gate and answerer, but nothing is sent or logged. */
  async preview(text: string): Promise<{
    decision: Decision
    answer: Answer | null
    via: 'extractive' | 'ai' | null
    agent?: AgentTurnResult
  }> {
    const s = this.d.settings.get()
    const provider = s.mode === 'ai' ? this.d.ai() : null
    if (provider) {
      const agent = await this.d.agent.handleTurn({
        chatId: '__preview__', text, profile: this.d.brand(), provider, cfg: s.ai, dryRun: true, memory: s.memoryEnabled
      })
      // The AI decides by intent, not by retrieval: a greeting or thanks needs no document and is still answered.
      const decision: Decision =
        agent.intent === 'di_luar_konteks'
          ? { kind: 'out_of_context', reason: agent.hits.length === 0 ? 'no_hits' : 'below_threshold' }
          : { kind: 'answerable', hits: agent.hits }
      const answer = agent.replyParts.length
        ? { text: agent.replyParts.join('\n\n'), sources: agent.sources }
        : null
      return { decision, answer, via: 'ai', agent }
    }
    const decision = decide(text, this.d.store.search(text, TOP_K), s.threshold)
    if (decision.kind === 'out_of_context') return { decision, answer: null, via: null }
    return { decision, answer: buildExtractiveAnswer(text, decision.hits), via: 'extractive' }
  }

  private async outOfContext(m: IncomingMessage, top: number | null) {
    const { action, replyText } = this.d.settings.get().outOfContext
    if (action === 'reply') await this.send(m.chatId, replyText)
    else if (action === 'escalate') this.emit('escalate', m)
    return { result: { kind: 'out_of_context', action } as PipelineResult, top, sources: [] as string[] }
  }

  /**
   * Sends a system message (a verification code or a notice to the owner) that must leave no trace in the conversation.
   * Like every other send it is registered as in flight, so its echo from WhatsApp is not mistaken for a person typing
   * from the phone (which would pause the bot). Nothing is written to the feed, the turns, the log or the memory, and no
   * customer-reply cooldown is started.
   */
  async sendSystem(chatId: string, text: string): Promise<string | null> {
    const pending: IncomingMessage[] = []
    this.inflight.set(chatId, pending)
    let sentId: string | null = null
    try {
      sentId = await this.d.gateway.sendText(chatId, text)
      if (sentId) this.d.conv.rememberSentId(sentId)
    } finally {
      this.inflight.delete(chatId)
    }
    for (const p of pending) if (p.id !== sentId) this.takeover(p)
    return sentId
  }

  /**
   * A person answers from the app. The chat is taken over first (the bot goes quiet, with no time limit), and the
   * message is registered as in flight so its echo from WhatsApp is not mistaken for typing on the phone.
   */
  async adminSend(chatId: string, text: string): Promise<void> {
    this.d.conv.takeOver(chatId)
    const pending: IncomingMessage[] = []
    this.inflight.set(chatId, pending)
    let sentId: string | null = null
    try {
      sentId = await this.d.gateway.sendText(chatId, text)
      if (sentId) this.d.conv.rememberSentId(sentId)
      this.d.conv.appendTurn(chatId, 'admin', text)
      this.record(() => this.d.feed?.recordAdmin(chatId, text, sentId))
    } finally {
      this.inflight.delete(chatId)
    }
  }

  private async send(chatId: string, text: string, typing?: number): Promise<void> {
    // A human may have taken over while the answer was being prepared. (The 'menunggu_admin' pause is our
    // own handoff, whose farewell must still be delivered.)
    if (this.d.conv.getState(chatId).status === 'manusia') throw new PausedError()
    const typingMs = typing ?? TYPING_MIN_MS + Math.floor(this.d.rand() * (TYPING_SPAN_MS + 1))
    const pending: IncomingMessage[] = []
    this.inflight.set(chatId, pending)
    let sentId: string | null = null
    try {
      sentId = await this.d.gateway.sendText(chatId, text, { typingMs })
      if (sentId) this.d.conv.rememberSentId(sentId)
      this.record(() => this.d.feed?.recordOutgoing(chatId, text, sentId))
    } finally {
      this.inflight.delete(chatId)
    }
    // Own messages seen during the send: ours (same id) or a human typing (different id).
    for (const p of pending) if (p.id !== sentId) this.takeover(p)
    this.d.db
      .prepare(
        `INSERT INTO cooldowns(chat_id, last_at) VALUES (?, ?)
         ON CONFLICT(chat_id) DO UPDATE SET last_at = excluded.last_at`
      )
      .run(chatId, this.d.clock.now())
  }
}

function describe(r: PipelineResult): string {
  switch (r.kind) {
    case 'ignored': return `ignored:${r.why}`
    case 'replied': return `replied:${r.via}`
    case 'out_of_context': return `out_of_context:${r.action}`
    case 'handoff': return `handoff:${r.reason}`
    case 'error': return `error:${r.message}`
  }
}

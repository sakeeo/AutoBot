import { EventEmitter } from 'node:events'
import type { Db } from '../db'
import type { IndexStore } from '../knowledge/index-store'
import type { SettingsStore } from '../settings'
import type { WaGateway } from '../wa/gateway'
import type { Answer, Decision, Hit, IncomingMessage } from '../../shared/types'
import { decide } from '../answer/gate'
import { buildExtractiveAnswer } from '../answer/extractive'
import { AiError, askAi, type AiProvider } from '../answer/ai-answerer'
import type { ConversationStore } from '../conversation/store'
import type { BrandProfile } from '../../shared/brand'

export type PipelineResult =
  | {
      kind: 'ignored'
      why: 'from_me' | 'no_text' | 'group' | 'status' | 'stale' | 'duplicate' | 'cooldown' | 'human'
    }
  | { kind: 'replied'; sources: string[]; via: 'extractive' | 'ai' }
  | { kind: 'out_of_context'; action: 'reply' | 'silent' | 'escalate' }
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
    // Our own messages never wait behind a customer message: a human may type while the bot is still composing.
    if (m.fromMe) return Promise.resolve(this.handleOwn(m))
    const prev = this.chains.get(m.chatId) ?? Promise.resolve()
    const next = prev.then(() => this.run(m))
    const tail = next.catch(() => undefined)
    this.chains.set(m.chatId, tail)
    void tail.then(() => {
      if (this.chains.get(m.chatId) === tail) this.chains.delete(m.chatId)
    })
    return next
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
    this.d.conv.pauseFor(m.chatId, 'manusia', this.d.brand().limits.pauseHours)
    this.d.conv.appendTurn(m.chatId, 'admin', m.text ?? '(pesan non-teks)')
  }

  private async run(m: IncomingMessage): Promise<PipelineResult> {
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
    if (this.d.clock.now() - m.timestamp > STALE_MS) return ignored('stale')
    if (this.d.conv.isPaused(m.chatId)) return ignored('human')

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

    const answered = await this.answer(m.text, decision.hits, s.mode, s.ai)
    if (!answered) return this.outOfContext(m, top)
    await this.send(m.chatId, answered.answer.text)
    return {
      result: { kind: 'replied', sources: answered.answer.sources, via: answered.via },
      top,
      sources: answered.answer.sources
    }
  }

  /** Dry run for the "Uji Jawaban" panel: same retrieval, gate and answerer, but nothing is sent or logged. */
  async preview(text: string): Promise<{ decision: Decision; answer: Answer | null; via: 'extractive' | 'ai' | null }> {
    const s = this.d.settings.get()
    const decision = decide(text, this.d.store.search(text, TOP_K), s.threshold)
    if (decision.kind === 'out_of_context') return { decision, answer: null, via: null }
    const answered = await this.answer(text, decision.hits, s.mode, s.ai)
    return { decision, answer: answered?.answer ?? null, via: answered?.via ?? null }
  }

  private async answer(
    text: string,
    hits: Hit[],
    mode: 'extractive' | 'ai',
    ai: { model: string; maxTokens: number }
  ): Promise<{ answer: Answer; via: 'extractive' | 'ai' } | null> {
    const extractive = () => ({ answer: buildExtractiveAnswer(text, hits), via: 'extractive' as const })
    if (mode !== 'ai') return extractive()
    const provider = this.d.ai()
    if (!provider) return extractive()
    try {
      const a = await askAi(provider, text, hits, ai)
      return a ? { answer: a, via: 'ai' } : null
    } catch (e) {
      if (e instanceof AiError) return extractive()
      throw e
    }
  }

  private async outOfContext(m: IncomingMessage, top: number | null) {
    const { action, replyText } = this.d.settings.get().outOfContext
    if (action === 'reply') await this.send(m.chatId, replyText)
    else if (action === 'escalate') this.emit('escalate', m)
    return { result: { kind: 'out_of_context', action } as PipelineResult, top, sources: [] as string[] }
  }

  private async send(chatId: string, text: string): Promise<void> {
    // The human may have taken over while the answer was being prepared.
    if (this.d.conv.isPaused(chatId)) throw new PausedError()
    const typingMs = TYPING_MIN_MS + Math.floor(this.d.rand() * (TYPING_SPAN_MS + 1))
    const pending: IncomingMessage[] = []
    this.inflight.set(chatId, pending)
    let sentId: string | null = null
    try {
      sentId = await this.d.gateway.sendText(chatId, text, { typingMs })
      if (sentId) this.d.conv.rememberSentId(sentId)
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
    case 'error': return `error:${r.message}`
  }
}

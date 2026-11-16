import { EventEmitter } from 'node:events'
import type { Campaign } from '../../shared/broadcast'
import type { ConversationStore } from '../conversation/store'
import type { MessageFeed } from '../messages/message-feed'
import type { WaGateway } from '../wa/gateway'
import { evaluateBreaker } from './breaker'
import { checkSend, type GateContext } from './gate'
import { OPTOUT_FOOTER, renderTemplate, withFooter } from './lint'
import {
  BATCH_SIZE, TIER_LIMITS, activeDayIndex, batchPauseMs, dailyCap, effectiveTier, localDay, nextDelayMs, type Window
} from './limits'
import type { BroadcastStore } from './store'

export interface SafetySettings {
  enabled: boolean
  /** Age of the number in days when declared (declared once; the tier then grows with time). */
  ageDays: number
  declaredAt: number
  window: Window
  minGapDays: number
  /** Warm-up counts only sends from this time on (reset when the user changes their number). */
  warmupFrom: number
}

export interface EngineDeps {
  store: BroadcastStore
  gateway: WaGateway
  feed?: MessageFeed
  conv: ConversationStore
  clock: { now(): number }
  rand: () => number
  isBusy(): boolean
  connected(): boolean
  /** Sends one message and returns its WhatsApp id. The pipeline supplies one that tracks the echo; default is the gateway. */
  send?(jid: string, text: string, typingMs: number): Promise<string | null>
  settings(): SafetySettings
  businessName(): string
}

const MAX_SKIPS_PER_TICK = 50

/**
 * Sends the queued messages of one campaign at a time, one per step. Every rule is re-checked for each message
 * (see gate.ts); a tripped breaker pauses the campaign and nothing resumes it except the user.
 * Events: 'progress', 'paused', 'done', 'engine_error'.
 */
export class BroadcastEngine extends EventEmitter {
  private nextAt = 0
  private batchPausedUntil: number | null = null
  private sinceBatch = 0
  private ticking = false
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private d: EngineDeps) {
    super()
    // The batch pause survives a restart, so closing the app is not a way around it.
    try {
      const b = JSON.parse(d.store.getState('batch') ?? '{}') as { since?: number; pausedUntil?: number | null }
      this.sinceBatch = b.since ?? 0
      this.batchPausedUntil = b.pausedUntil ?? null
    } catch { /* start fresh */ }
  }

  private saveBatch(): void {
    this.d.store.setState('batch', JSON.stringify({ since: this.sinceBatch, pausedUntil: this.batchPausedUntil }))
  }

  // ---- lifecycle ----

  start(id: number): void {
    const c = this.d.store.getCampaign(id)
    if (!c || !['draf', 'terjadwal', 'dijeda'].includes(c.status)) return
    // The audience is fixed the moment the user confirms, even if the campaign has to wait in the queue.
    if (this.d.store.sendCount(c.id) === 0) this.d.store.enqueue(c.id)
    // Resuming is an acknowledgement: only problems after this moment can stop the campaign again.
    if (c.status === 'dijeda') this.d.store.setState(`resume:${c.id}`, String(this.d.clock.now()))
    const running = this.d.store.runningCampaign()
    if (running && running.id !== id) {
      this.d.store.setCampaignStatus(id, 'terjadwal')
      return
    }
    this.begin(c)
  }

  private begin(c: Campaign): void {
    if (this.d.store.sendCount(c.id) === 0) this.d.store.enqueue(c.id)
    this.d.store.setCampaignStatus(c.id, 'berjalan')
    this.emitProgress(c.id)
  }

  /** Only a running campaign can be paused; a stopped or finished one is never brought back to life. */
  pause(id: number, reason = 'Dijeda oleh pengguna.'): void {
    if (this.d.store.getCampaign(id)?.status !== 'berjalan') return
    this.d.store.setCampaignStatus(id, 'dijeda', reason)
    this.emit('paused', { campaignId: id, reason })
  }

  stop(id: number): void {
    this.d.store.setCampaignStatus(id, 'dihentikan')
    this.d.store.skipRemaining(id, 'dihentikan')
    this.emitProgress(id)
  }

  stopAll(): void {
    for (const c of this.d.store.listCampaigns())
      if (['berjalan', 'terjadwal', 'dijeda'].includes(c.status)) this.stop(c.id)
  }

  /** A campaign that was running when the app closed is paused, never silently continued. */
  resetAfterRestart(): void {
    this.d.store.settleInterrupted(this.d.clock.now())
    const c = this.d.store.runningCampaign()
    if (c) this.pause(c.id, 'Aplikasi dimulai ulang. Periksa lalu lanjutkan.')
  }

  startTimer(ms = 2000): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      this.tick().catch((e) => this.emit('engine_error', e))
    }, ms)
  }

  stopTimer(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Called when someone opts out or complains; the persisted signal can pause the running campaign at once. */
  onSignal(kind: 'optout' | 'complaint' | 'reply'): void {
    if (kind === 'reply') return
    this.d.store.addEvent(kind, this.d.clock.now())
    const c = this.d.store.runningCampaign()
    if (c) this.checkBreaker(c)
  }

  // ---- sending ----

  async tick(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      for (let i = 0; i < MAX_SKIPS_PER_TICK; i++) if (!(await this.step())) break
    } finally {
      this.ticking = false
    }
  }

  /** One step; true means "that was a skip, carry on straight away". */
  private async step(): Promise<boolean> {
    const { store, clock } = this.d
    const now = clock.now()
    const c = store.runningCampaign()
    if (!c) {
      const next = store.nextScheduled(now)
      if (next) this.begin(next)
      return false
    }
    const q = store.nextQueued(c.id)
    if (!q) {
      store.setCampaignStatus(c.id, 'selesai')
      this.emit('done', { campaignId: c.id })
      this.emitProgress(c.id)
      return false
    }
    if (now < this.nextAt) return false

    if (this.checkBreaker(c)) return false
    const decision = checkSend(q.contact, this.context(c, q.contact.id, now))
    if (decision.kind === 'halt') {
      this.pause(c.id, decision.reason)
      return false
    }
    if (decision.kind === 'wait') return false
    if (decision.kind === 'skip') {
      store.recordSend(q.sendId, { status: 'dilewati', reason: decision.reason, at: now })
      this.emitProgress(c.id)
      return true
    }
    // The user may have stopped or paused it while we were deciding.
    if (store.getCampaign(c.id)?.status !== 'berjalan') return false

    const contact = q.contact
    const jid = contact.jid ?? `${contact.number}@s.whatsapp.net`
    const text = withFooter(renderTemplate(c.template, { ...contact.vars, nama: contact.name, bisnis: this.d.businessName() }))
    // Marked in flight BEFORE sending: whatever fails afterwards, this message is never sent a second time.
    store.markSending(q.sendId)
    const send = this.d.send ?? ((j: string, t: string, typingMs: number) => this.d.gateway.sendText(j, t, { typingMs }))
    let waId: string | null = null
    let sent = false
    try {
      waId = await send(jid, text, 2000 + Math.floor(this.d.rand() * 3000))
      sent = true
    } catch (e) {
      try { store.recordSend(q.sendId, { status: 'gagal', reason: (e as Error).message, at: clock.now() }) } catch { /* settled on restart */ }
      this.nextAt = clock.now() + nextDelayMs(this.d.rand)
    }
    if (sent) {
      const at = clock.now()
      try { store.recordSend(q.sendId, { status: 'terkirim', waId, at }) } catch { /* left in flight; counted as sent after a restart */ }
      try {
        if (waId) this.d.conv.rememberSentId(waId)
        this.d.feed?.recordOutgoing(jid, text, waId)
      } catch { /* the feed is only a view */ }
      this.nextAt = at + nextDelayMs(this.d.rand)
      if (++this.sinceBatch >= BATCH_SIZE) {
        this.sinceBatch = 0
        this.batchPausedUntil = at + batchPauseMs(this.d.rand)
        this.nextAt = Math.max(this.nextAt, this.batchPausedUntil)
      }
      try { this.saveBatch() } catch { /* best effort */ }
    }
    this.emitProgress(c.id)
    this.checkBreaker(c)
    return false
  }

  private context(c: Campaign, contactId: number, now: number): GateContext {
    const s = this.d.settings()
    const counters = this.d.store.counters(now, s.window.timezone)
    return {
      now,
      connected: this.d.connected(),
      globalEnabled: s.enabled,
      busy: this.d.isBusy(),
      tier: effectiveTier({ ageDays: s.ageDays, declaredAt: s.declaredAt }, now),
      window: s.window,
      activeDay: activeDayIndex(this.daysSince(counters.sendDays, s), localDay(now, s.window.timezone)),
      counters: {
        sentToday: counters.sentToday,
        sentThisHour: counters.sentThisHour,
        sentLast24h: counters.sentLast24h,
        newToday: counters.newToday,
        sinceBatchPause: this.sinceBatch,
        lastSentAt: counters.lastSentAt,
        batchPausedUntil: this.batchPausedUntil
      },
      kind: c.kind,
      minGapDays: s.minGapDays,
      isSuppressed: (ct) => !!this.d.store.isSuppressed({ number: ct.number, jid: ct.jid }),
      contactHistory: this.d.store.contactHistory(contactId, now)
    }
  }

  private daysSince(days: string[], s: SafetySettings): string[] {
    const from = localDay(s.warmupFrom, s.window.timezone)
    return days.filter((d) => d >= from)
  }

  /** True (and the campaign paused) when a warning sign is present. Only signs since the last resume count. */
  private checkBreaker(c: Campaign): boolean {
    const { store } = this.d
    const cur = store.getCampaign(c.id)
    if (!cur || cur.status !== 'berjalan') return false
    const resumeAt = Number(store.getState(`resume:${c.id}`) ?? 0)
    const recent = store.recentOutcomes(30, resumeAt)
    const since = Math.max(recent.length >= 30 ? recent[0].at : 0, resumeAt)
    const r = evaluateBreaker(
      recent,
      { lastOptOuts: store.eventsSince('optout', since), lastComplaints: store.eventsSince('complaint', since) },
      c.kind
    )
    if (!r.trip) return false
    this.pause(c.id, r.reason)
    return true
  }

  private emitProgress(campaignId: number): void {
    this.emit('progress', { campaignId, ...this.d.store.progress(campaignId) })
  }

  // ---- preview ----

  /** Who a campaign would reach, who is skipped and why, and roughly how many days it would take. */
  preview(id: number): { eligible: number; skipped: Record<string, number>; estimatedDays: number } {
    const { store, clock } = this.d
    const c = store.getCampaign(id)
    const out = { eligible: 0, skipped: {} as Record<string, number>, estimatedDays: 0 }
    if (!c) return out
    const s = this.d.settings()
    const now = clock.now()
    const skip = (r: string): void => { out.skipped[r] = (out.skipped[r] ?? 0) + 1 }
    let fresh = 0
    for (const ct of store.audienceContacts(c.kind, c.audience)) {
      if (store.isSuppressed({ number: ct.number, jid: ct.jid })) { skip('tolak'); continue }
      if (ct.number === null) { skip('nomor_tidak_diketahui'); continue }
      const h = store.contactHistory(ct.id, now)
      if (h.lastSentAt !== null && now - h.lastSentAt < s.minGapDays * 86_400_000) { skip('terlalu_cepat'); continue }
      if (h.sentLast30d >= 4) { skip('batas_30_hari'); continue }
      out.eligible++
      if (h.neverSent) fresh++
    }
    const tier = effectiveTier({ ageDays: s.ageDays, declaredAt: s.declaredAt }, now)
    const counters = store.counters(now, s.window.timezone)
    const day0 = activeDayIndex(this.daysSince(counters.sendDays, s), localDay(now, s.window.timezone))
    let left = out.eligible
    let days = 0
    while (left > 0 && days < 365) {
      left -= dailyCap(tier, day0 + days)
      days++
    }
    out.estimatedDays = Math.max(days, Math.ceil(fresh / TIER_LIMITS[tier].newContacts))
    return out
  }
}

export { OPTOUT_FOOTER }

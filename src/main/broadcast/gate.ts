import type { BContact, CampaignKind, Tier } from '../../shared/broadcast'
import { HOURLY_MAX, TIER_LIMITS, dailyCap, inSendWindow, nextDayWindowStart, nextWindowStart, type Window } from './limits'

export type GateDecision =
  | { kind: 'allow' }
  | { kind: 'wait'; until: number; why: string }
  | { kind: 'skip'; reason: string }
  | { kind: 'halt'; reason: string }

export interface GateContext {
  now: number
  connected: boolean
  globalEnabled: boolean
  /** A customer reply is being prepared or sent: broadcast yields to it. */
  busy: boolean
  tier: Tier
  window: Window
  activeDay: number
  counters: {
    sentToday: number
    sentThisHour: number
    sentLast24h: number
    newToday: number
    sinceBatchPause: number
    lastSentAt: number | null
    batchPausedUntil: number | null
  }
  kind: CampaignKind
  minGapDays: number
  isSuppressed(c: BContact): boolean
  contactHistory: { lastSentAt: number | null; sentLast30d: number; neverSent: boolean }
}

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000
const BUSY_RETRY_MS = 5_000
const MAX_PER_30_DAYS = 4
const MIN_GAP_MS = 20_000

/**
 * Every rule that decides whether one message may go out right now. The first rule that matches wins, so a
 * suppressed contact is skipped even outside the send window. Evaluated for each send, never once per campaign.
 */
export function checkSend(contact: BContact, ctx: GateContext): GateDecision {
  if (!ctx.connected) return { kind: 'halt', reason: 'Koneksi WhatsApp terputus.' }
  if (!ctx.globalEnabled) return { kind: 'halt', reason: 'Broadcast sedang dimatikan.' }

  if (ctx.isSuppressed(contact)) return { kind: 'skip', reason: 'tolak' }
  if (contact.status === 'tidak_aktif') return { kind: 'skip', reason: 'tidak_aktif' }
  if (contact.status === 'menunggu_persetujuan' && ctx.kind !== 'konfirmasi') return { kind: 'skip', reason: 'menunggu_persetujuan' }
  if (contact.number === null) return { kind: 'skip', reason: 'nomor_tidak_diketahui' }
  // A confirmation is for someone still waiting who was never messaged; anything else would be a second message.
  if (ctx.kind === 'konfirmasi' && (contact.status !== 'menunggu_persetujuan' || !ctx.contactHistory.neverSent))
    return { kind: 'skip', reason: 'sudah_dikonfirmasi' }

  if (!inSendWindow(ctx.now, ctx.window)) return { kind: 'wait', until: nextWindowStart(ctx.now, ctx.window), why: 'di luar jam kirim' }
  if (ctx.busy) return { kind: 'wait', until: ctx.now + BUSY_RETRY_MS, why: 'bot sedang membalas pelanggan' }
  const pause = ctx.counters.batchPausedUntil
  if (pause !== null && ctx.now < pause) return { kind: 'wait', until: pause, why: 'jeda antar batch' }
  const last = ctx.counters.lastSentAt
  if (last !== null && ctx.now - last < MIN_GAP_MS) return { kind: 'wait', until: last + MIN_GAP_MS, why: 'jeda antar pesan' }
  if (ctx.counters.sentThisHour >= HOURLY_MAX)
    return { kind: 'wait', until: (Math.floor(ctx.now / HOUR_MS) + 1) * HOUR_MS, why: 'batas per jam tercapai' }
  // The rolling 24 h count backs up the calendar day, so changing the time zone cannot reset the cap.
  if (ctx.counters.sentToday >= dailyCap(ctx.tier, ctx.activeDay) || ctx.counters.sentLast24h >= dailyCap(ctx.tier, ctx.activeDay))
    return { kind: 'wait', until: nextDayWindowStart(ctx.now, ctx.window), why: 'batas harian tercapai' }
  if (ctx.contactHistory.neverSent && ctx.counters.newToday >= TIER_LIMITS[ctx.tier].newContacts)
    return { kind: 'wait', until: nextDayWindowStart(ctx.now, ctx.window), why: 'batas kontak baru hari ini tercapai' }

  const lastToContact = ctx.contactHistory.lastSentAt
  if (lastToContact !== null && ctx.now - lastToContact < ctx.minGapDays * DAY_MS) return { kind: 'skip', reason: 'terlalu_cepat' }
  if (ctx.contactHistory.sentLast30d >= MAX_PER_30_DAYS) return { kind: 'skip', reason: 'batas_30_hari' }
  return { kind: 'allow' }
}

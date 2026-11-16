import type { CampaignKind } from '../../shared/broadcast'

export interface Outcome { at: number; ok: boolean; kind: CampaignKind; toNonChat: boolean }
export interface BreakerSignals {
  /** Opt-outs among the last 30 sends. */
  lastOptOuts: number
  lastComplaints: number
  /** Replies received from non-chat (imported) contacts that were messaged. */
  repliesAmongNonChat: number
}

const NO_REPLY_LIMIT: Record<CampaignKind, number> = { broadcast: 30, konfirmasi: 20 }

/**
 * Warning signs that must stop a campaign. A tripped campaign is paused and never resumes by itself.
 * `recent` is the outcome history of recent sends, oldest first.
 */
export function evaluateBreaker(
  recent: Outcome[],
  sig: BreakerSignals,
  kind: CampaignKind
): { trip: false } | { trip: true; reason: string } {
  const last3 = recent.slice(-3)
  if (last3.length === 3 && last3.every((o) => !o.ok))
    return { trip: true, reason: 'Tiga pengiriman gagal berturut-turut. Periksa koneksi dan nomor Anda.' }

  const last20 = recent.slice(-20)
  if (last20.length >= 10 && last20.filter((o) => !o.ok).length / last20.length >= 0.2)
    return { trip: true, reason: 'Lebih dari 20% pengiriman terakhir gagal.' }

  if (sig.lastComplaints >= 1)
    return { trip: true, reason: 'Ada penerima yang menulis keluhan/laporan spam. Tinjau pesan dan daftar penerima.' }
  if (sig.lastOptOuts >= 3)
    return { trip: true, reason: 'Tiga penerima berhenti berlangganan dalam 30 pengiriman terakhir. Tinjau isi pesan.' }

  const toNonChat = recent.filter((o) => o.ok && o.toNonChat).length
  if (toNonChat >= NO_REPLY_LIMIT[kind] && sig.repliesAmongNonChat === 0)
    return { trip: true, reason: `${toNonChat} pesan terkirim ke kontak impor tanpa satu pun balasan. Kualitas daftar patut diragukan.` }
  return { trip: false }
}

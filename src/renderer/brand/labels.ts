import type { ActionKind, Intent } from '../../shared/brand'

export const INTENT_LABEL: Record<Intent, string> = {
  tanya_harga: 'Tanya harga',
  tanya_produk: 'Tanya produk',
  siap_beli: 'Siap beli',
  keberatan: 'Keberatan',
  minta_manusia: 'Minta bicara dengan manusia',
  komplain: 'Komplain',
  sapaan: 'Sapaan',
  terima_kasih: 'Terima kasih',
  di_luar_konteks: 'Di luar konteks',
  spam: 'Spam'
}

export const ACTION_LABEL: Record<ActionKind, string> = {
  send_checkout: 'Kirim checkout',
  send_link: 'Kirim tautan',
  handoff: 'Serah ke admin',
  ask_lead: 'Tanya data lead',
  reply_only: 'Balas saja',
  silent: 'Diam'
}

export const GOAL_LABEL = {
  checkout: 'Checkout',
  handoff: 'Serah ke admin',
  lead: 'Kumpulkan lead',
  booking: 'Booking jadwal',
  form: 'Kirim ke formulir'
} as const

export const uid = (prefix: string): string => `${prefix}${Math.random().toString(36).slice(2, 8)}`

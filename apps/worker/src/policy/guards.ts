import { normalizeNumber } from '@autobot/contracts/brand'

/** Splits on sentence ends and line breaks (a sentence keeps its trailing punctuation). */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])[ \t]+|\n+/).filter((s) => s.trim() !== '')
}

/** True when `text` contains `number` written in any common phone format (0851-…, +62 …, wa.me/62…). */
export function containsNumber(text: string, number: string): boolean {
  const target = normalizeNumber(number)
  if (!target) return false
  const candidates = text.match(/\+?\d[\d\s().-]{5,}\d/g) ?? []
  return candidates.some((c) => normalizeNumber(c) === target)
}

/** Drops every sentence that carries the bot's own number. */
export function removeSelfNumber(text: string, botNumber: string): { text: string; removed: boolean } {
  const parts = sentences(text)
  const kept = parts.filter((s) => !containsNumber(s, botNumber))
  if (kept.length === parts.length) return { text, removed: false }
  return { text: kept.join(' '), removed: true }
}

export function extractUrls(text: string): string[] {
  return (text.match(/https?:\/\/[^\s)>\]"']+/gi) ?? []).map((u) => u.replace(/[.,;:!?]+$/, ''))
}

function isAllowed(url: string, allowed: string[]): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  return allowed.some((a) => {
    try {
      const b = new URL(a)
      return u.origin === b.origin && u.pathname.startsWith(b.pathname)
    } catch {
      return false
    }
  })
}

/** Removes sentences containing a URL that is not on the allowlist (https origin + path prefix). */
export function stripDisallowedUrls(text: string, allowed: string[]): { text: string; removed: string[] } {
  const removed: string[] = []
  const parts = sentences(text)
  const kept = parts.filter((s) => {
    const bad = extractUrls(s).filter((u) => !isAllowed(u, allowed))
    removed.push(...bad)
    return bad.length === 0
  })
  return removed.length === 0 ? { text, removed } : { text: kept.join(' '), removed }
}

const FACTOR: Record<string, number> = { juta: 1e6, jt: 1e6, ribu: 1e3, rb: 1e3, k: 1e3 }

function moneyValue(num: string, mult?: string): number {
  const factor = mult ? FACTOR[mult.toLowerCase()] ?? 1 : 1
  if (factor > 1) {
    const n = num.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')
    return Math.round(parseFloat(n) * factor)
  }
  return parseInt(num.replace(/[.,]/g, ''), 10)
}

/** First rupiah amount found in free text ("Rp1.500.000", "1,5 juta", "25rb", 15000), or null. */
export function parseRupiah(s: string): number | null {
  const m = /(\d[\d.,]*)(?:\s*(juta|jt|ribu|rb|k)\b)?/i.exec(s)
  if (!m) return null
  const v = moneyValue(m[1], m[2])
  return Number.isFinite(v) ? v : null
}

function strictMoney(text: string): number[] {
  const re =
    /rp\.?\s*(\d[\d.,]*)(?:\s*(juta|jt|ribu|rb|k)\b)?|(\d[\d.,]*)\s*(juta|jt|ribu|rb)\b|\b(\d{1,3}(?:[.,]\d{3})+|\d{5,})\b/gi
  const out: number[] = []
  for (const m of text.matchAll(re)) {
    const v = m[1] !== undefined ? moneyValue(m[1], m[2]) : m[3] !== undefined ? moneyValue(m[3], m[4]) : moneyValue(m[5])
    if (Number.isFinite(v)) out.push(v)
  }
  return out
}

function looseNumbers(text: string): Set<number> {
  const out = new Set<number>()
  for (const m of text.matchAll(/(\d[\d.,]*)(?:\s*(juta|jt|ribu|rb|k)\b)?/gi)) {
    const v = moneyValue(m[1], m[2])
    if (Number.isFinite(v)) out.add(v)
  }
  return out
}

/** Money-like numbers in `reply` that never appear in `context` (compared after normalising units). */
export function unknownNumbers(reply: string, context: string): string[] {
  const known = looseNumbers(context)
  return [...new Set(strictMoney(reply).filter((v) => !known.has(v)))].map(String)
}

/** Sentences that send a customer who is already chatting with us to contact us somewhere else. */
const REFERRAL_PATTERNS = [
  /\b(hubungi|kontak|chat|dm|tanya\w*|konsultasi\w*|diskusi\w*|pesan|order|minta)\b[^.\n]{0,40}\b(lewat|via|melalui)\s+(whatsapp|wa)\b/i,
  /\bhubungi (kami|admin|tim)\b/i,
  /\bnomor (whatsapp|wa)\s+kami\b/i,
  /\bklik (tombol|tautan|link)\b/i,
  /\bisi (formulir|form)\b/i,
  /\bwa\.me\b/i
]

/** Drops model sentences telling the customer to contact us on WhatsApp / click buttons / fill forms. */
export function removeCtaSentences(text: string): { text: string; removed: boolean } {
  const parts = sentences(text)
  const kept = parts.filter((s) => !REFERRAL_PATTERNS.some((p) => p.test(s)))
  if (kept.length === parts.length) return { text, removed: false }
  return { text: kept.join(' '), removed: true }
}

const CTA_PATTERNS = [
  /hubungi (kami )?(lewat|via|melalui) whatsapp/i,
  /klik (tombol|tautan|link)/i,
  /isi (formulir|form)\b/i,
  /kunjungi halaman/i,
  /(tanya|konsultasi|chat|hubungi|minta|diskusi\w*)[^.\n]{0,40}(lewat|via|melalui) whatsapp/i,
  /tombol (whatsapp|pesan)/i
]

const HUMAN_ONLY = /<!--\s*hanya untuk manusia\s*-->/i

/** Removes website-only calls to action and anything marked human-only before text reaches the model. */
export function sanitizeChunk(text: string, botNumber: string | null): string {
  const out: string[] = []
  let skipping = false
  for (const line of text.split('\n')) {
    if (HUMAN_ONLY.test(line)) {
      skipping = true
      continue
    }
    if (skipping) {
      if (/^#/.test(line)) skipping = false
      else continue
    }
    if (botNumber && containsNumber(line, botNumber)) continue
    if (CTA_PATTERNS.some((p) => p.test(line))) continue
    out.push(line)
  }
  return out.join('\n')
}

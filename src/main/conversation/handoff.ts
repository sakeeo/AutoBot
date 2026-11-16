import { EventEmitter } from 'node:events'
import { normalizeNumber, type AdminEntry, type BrandProfile } from '../../shared/brand'
import type { WaGateway } from '../wa/gateway'
import type { ConversationStore } from './store'

const DAY_NAMES: Record<string, string> = {
  '1': 'Senin', '2': 'Selasa', '3': 'Rabu', '4': 'Kamis', '5': 'Jumat', '6': 'Sabtu', '0': 'Minggu'
}
const DAY_ORDER = ['1', '2', '3', '4', '5', '6', '0'] as const
const TZ_LABEL: Record<string, string> = {
  'Asia/Makassar': 'WITA', 'Asia/Jakarta': 'WIB', 'Asia/Jayapura': 'WIT'
}
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** Whether `nowMs` falls inside the profile's working hours, evaluated in the profile's timezone. */
export function isWithinHours(profile: BrandProfile, nowMs: number): boolean {
  const fmt = (timeZone: string) =>
    new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(new Date(nowMs))
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = fmt(profile.hours.timezone)
  } catch {
    parts = fmt('UTC')
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const day = WEEKDAY_INDEX[get('weekday')]
  const minutes = (Number(get('hour')) % 24) * 60 + Number(get('minute'))
  const hours = profile.hours.days[String(day) as keyof BrandProfile['hours']['days']]
  if (!hours) return false
  return minutes >= toMinutes(hours.open) && minutes < toMinutes(hours.close)
}

/** "Senin–Jumat 09:00–17:00 WITA" */
export function formatHoursText(profile: BrandProfile): string {
  const groups: { from: string; to: string; span: string }[] = []
  for (const d of DAY_ORDER) {
    const h = profile.hours.days[d]
    if (!h) continue
    const span = `${h.open}–${h.close}`
    const last = groups[groups.length - 1]
    const prevIdx = last ? DAY_ORDER.findIndex((x) => DAY_NAMES[x] === last.to) : -1
    if (last && last.span === span && DAY_ORDER[prevIdx + 1] === d) last.to = DAY_NAMES[d]
    else groups.push({ from: DAY_NAMES[d], to: DAY_NAMES[d], span })
  }
  if (groups.length === 0) return 'tutup (jam kerja belum diatur)'
  const label = TZ_LABEL[profile.hours.timezone] ?? profile.hours.timezone
  return (
    groups.map((g) => `${g.from === g.to ? g.from : `${g.from}–${g.to}`} ${g.span}`).join(', ') + ` ${label}`
  )
}

export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{([a-z_]+)\}/g, (_m, k: string) => vars[k] ?? '')
}

export function greetingWord(profile: BrandProfile): string {
  return { kak: 'Kak', bapak_ibu: 'Bapak/Ibu', anda: 'Anda', ikuti: 'Kak' }[profile.style.greeting]
}

const REASON_LABEL: Record<string, string> = {
  komplain: 'Komplain pelanggan',
  minta_manusia: 'Pelanggan minta bicara dengan manusia',
  kata_kunci_sensitif: 'Topik sensitif (refund/tagihan/dll.)',
  keyakinan_rendah: 'Bot kurang yakin menjawab',
  tanpa_kemajuan: 'Percakapan tidak maju',
  luar_katalog_bernilai: 'Permintaan di luar katalog (penawaran/kerja sama)',
  ai_gagal: 'Layanan AI sedang bermasalah',
  saran_model: 'Siap dilanjutkan oleh tim',
  aturan: 'Sesuai aturan arah konversi'
}

export function formatLeadSummary(input: {
  profile: BrandProfile
  chatId: string
  reason: string
  lead: Record<string, string>
  productName: string | null
  lastTurns: { role: string; text: string }[]
}): string {
  const ROLE: Record<string, string> = { user: 'pelanggan', bot: 'bot', admin: 'admin' }
  const lines = [
    `🔔 Serah ke admin — ${input.profile.identity.businessName || 'bisnis Anda'}`,
    `Alasan: ${REASON_LABEL[input.reason] ?? input.reason}`,
    `Pelanggan: ${input.chatId.split('@')[0].replace(/\D/g, '') || input.chatId}`
  ]
  if (input.productName) lines.push(`Produk diminati: ${input.productName}`)
  const lead = Object.entries(input.lead)
  if (lead.length) lines.push('Data lead:', ...lead.map(([k, v]) => `- ${k}: ${v}`))
  if (input.lastTurns.length)
    lines.push('Pesan terakhir:', ...input.lastTurns.map((t) => `${ROLE[t.role] ?? t.role}: ${t.text}`))
  return lines.join('\n')
}

/** The goodbye sent to the customer on handoff; pure, so dry runs can show it without side effects. */
export function farewellText(
  profile: BrandProfile,
  nowMs: number,
  productName: string | null,
  lead: Record<string, string>
): string {
  const vars = {
    sapaan: greetingWord(profile),
    jam_kerja: formatHoursText(profile),
    produk: productName ?? '',
    nama: lead.nama ?? ''
  }
  let farewell = fillTemplate(profile.templates.handoffFarewell, vars)
  if (!isWithinHours(profile, nowMs)) farewell += ' ' + fillTemplate(profile.templates.outsideHours, vars)
  return farewell
}

export interface HandoffEvent {
  chatId: string
  reason: string
  summary: string
  notified: string[]
}

export class HandoffService extends EventEmitter {
  constructor(private d: { gateway: WaGateway; conv: ConversationStore; clock: { now(): number } }) {
    super()
  }

  async trigger(input: {
    profile: BrandProfile
    chatId: string
    reason: string
    adminId?: string
    productName: string | null
  }): Promise<{ farewell: string; notified: string[] }> {
    const { profile, chatId, reason } = input
    const { conv, gateway } = this.d

    conv.pauseFor(chatId, 'menunggu_admin', profile.limits.pauseHours)
    conv.recordHandoff(chatId, reason)
    conv.recordEvent(chatId, 'handoff')

    const state = conv.getState(chatId)
    const summary = formatLeadSummary({
      profile, chatId, reason, lead: state.lead, productName: input.productName,
      lastTurns: conv.recentTurns(chatId, 3)
    })

    const chosen = input.adminId ? profile.admins.find((a) => a.id === input.adminId) : undefined
    const recipients: AdminEntry[] = chosen ? [chosen] : profile.admins.filter((a) => a.notifyWhatsapp)
    const self = gateway.selfNumber()
    const notified: string[] = []
    for (const a of recipients) {
      if (self && normalizeNumber(a.number) === normalizeNumber(self)) continue
      try {
        await gateway.sendText(gateway.jidFor(normalizeNumber(a.number)), summary)
        notified.push(a.id)
      } catch {
        /* an unreachable admin must never break the customer's conversation */
      }
    }

    const farewell = farewellText(profile, this.d.clock.now(), input.productName, state.lead)

    const event: HandoffEvent = { chatId, reason, summary, notified }
    this.emit('handoff', event)
    return { farewell, notified }
  }
}

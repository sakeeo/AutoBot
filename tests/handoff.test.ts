import { describe, it, expect } from 'vitest'
import { openDb } from '../src/main/db'
import { ConversationStore } from '../src/main/conversation/store'
import {
  HandoffService, isWithinHours, formatHoursText, fillTemplate, formatLeadSummary
} from '../src/main/conversation/handoff'
import { PRESETS, type BrandProfile } from '../src/shared/brand'
import type { WaGateway } from '../src/main/wa/gateway'
import type { ConnStatus, IncomingMessage } from '../src/shared/types'

class FakeGateway implements WaGateway {
  sent: { chatId: string; text: string }[] = []
  failFor = new Set<string>()
  onMessage(_cb: (m: IncomingMessage) => void): void {}
  onStatus(_cb: (s: ConnStatus) => void): void {}
  async connect(): Promise<void> {}
  async logout(): Promise<void> {}
  selfNumber(): string | null { return '6285119308345' }
  jidFor(n: string): string { return `${n.replace(/\D/g, '')}@s.whatsapp.net` }
  async sendText(chatId: string, text: string): Promise<string | null> {
    if (this.failFor.has(chatId)) throw new Error('send failed')
    this.sent.push({ chatId, text })
    return `m${this.sent.length}`
  }
}

// 2026-11-16 is a Monday. Asia/Makassar is UTC+8.
const mondayWita = (h: number, m = 0) => Date.UTC(2026, 10, 16, h - 8, m)
const sundayWita = (h: number) => Date.UTC(2026, 10, 15, h - 8)

const profile = (): BrandProfile => {
  const p = structuredClone(PRESETS.jasa_agensi)
  p.identity = { ...p.identity, businessName: 'Kerabat Koding' }
  p.admins = [
    { id: 'a1', name: 'Budi', number: '0812-3456-7890', notifyWhatsapp: true },
    { id: 'a2', name: 'Sari', number: '0813-0000-1111', notifyWhatsapp: false }
  ]
  return p
}

describe('isWithinHours', () => {
  it('uses the profile timezone regardless of the machine timezone', () => {
    expect(isWithinHours(profile(), mondayWita(10))).toBe(true)
    expect(isWithinHours(profile(), mondayWita(20))).toBe(false)
    expect(isWithinHours(profile(), mondayWita(8, 59))).toBe(false)
    expect(isWithinHours(profile(), mondayWita(9, 0))).toBe(true)
    expect(isWithinHours(profile(), mondayWita(17, 0))).toBe(false)
  })
  it('treats a closed day as outside hours', () => {
    expect(isWithinHours(profile(), sundayWita(12))).toBe(false)
  })
  it('falls back safely on an invalid timezone', () => {
    const p = profile()
    p.hours.timezone = 'Mars/Olympus'
    expect(() => isWithinHours(p, mondayWita(10))).not.toThrow()
  })
})

describe('formatHoursText and fillTemplate', () => {
  it('groups consecutive days with identical hours and labels the timezone', () => {
    expect(formatHoursText(profile())).toBe('Senin–Jumat 09:00–17:00 WITA')
  })
  it('says tutup when every day is closed', () => {
    const p = profile()
    p.hours.days = { '0': null, '1': null, '2': null, '3': null, '4': null, '5': null, '6': null }
    expect(formatHoursText(p)).toMatch(/tutup|belum diatur/i)
  })
  it('fills known variables and leaves none behind for known keys', () => {
    expect(fillTemplate('Halo {sapaan}, {produk}', { sapaan: 'Kak', produk: 'Website' })).toBe('Halo Kak, Website')
    expect(fillTemplate('{a} {b}', { a: 'x' })).toBe('x ')
  })
})

describe('formatLeadSummary', () => {
  it('lists business, reason, customer number, lead data and last messages', () => {
    const s = formatLeadSummary({
      profile: profile(), chatId: '6281999000111@s.whatsapp.net', reason: 'komplain',
      lead: { nama: 'Budi', kebutuhan: 'aplikasi kasir' }, productName: 'Aplikasi Kasir',
      lastTurns: [{ role: 'user', text: 'barang rusak' }, { role: 'bot', text: 'Maaf ya Kak' }]
    })
    for (const t of ['Kerabat Koding', '6281999000111', 'nama: Budi', 'kebutuhan: aplikasi kasir', 'Aplikasi Kasir', 'barang rusak'])
      expect(s).toContain(t)
    expect(s).toMatch(/komplain/i)
  })
})

describe('HandoffService.trigger', () => {
  function setup() {
    const clock = { t: mondayWita(10), now() { return this.t } }
    const db = openDb(':memory:')
    const conv = new ConversationStore(db, clock)
    const gateway = new FakeGateway()
    const svc = new HandoffService({ gateway, conv, clock })
    return { clock, conv, gateway, svc }
  }
  const C = '6281999000111@s.whatsapp.net'

  it('pauses the chat as waiting for admin and messages the notifying admins only', async () => {
    const { conv, gateway, svc } = setup()
    conv.mergeLead(C, { nama: 'Budi' })
    const seen: unknown[] = []
    svc.on('handoff', (e) => seen.push(e))
    const r = await svc.trigger({ profile: profile(), chatId: C, reason: 'komplain', productName: null })
    expect(conv.getState(C).status).toBe('menunggu_admin')
    expect(conv.isPaused(C)).toBe(true)
    expect(gateway.sent).toHaveLength(1)
    expect(gateway.sent[0].chatId).toBe('6281234567890@s.whatsapp.net')
    expect(gateway.sent[0].text).toContain('Kerabat Koding')
    expect(r.notified).toEqual(['a1'])
    expect(seen).toHaveLength(1)
  })
  it('targets a specific admin when adminId is given, even if they do not get WhatsApp notices by default', async () => {
    const { gateway, svc } = setup()
    await svc.trigger({ profile: profile(), chatId: C, reason: 'minta_manusia', adminId: 'a2', productName: null })
    expect(gateway.sent.map((s) => s.chatId)).toEqual(['6281300001111@s.whatsapp.net'])
  })
  it('never sends to an admin whose number is the bot number', async () => {
    const { gateway, svc } = setup()
    const p = profile()
    p.admins = [{ id: 'bot', name: 'Bot', number: '0851-1930-8345', notifyWhatsapp: true }]
    const r = await svc.trigger({ profile: p, chatId: C, reason: 'komplain', productName: null })
    expect(gateway.sent).toEqual([])
    expect(r.notified).toEqual([])
  })
  it('does not throw when sending to an admin fails, and still records the handoff', async () => {
    const { conv, gateway, svc } = setup()
    gateway.failFor.add('6281234567890@s.whatsapp.net')
    const r = await svc.trigger({ profile: profile(), chatId: C, reason: 'komplain', productName: null })
    expect(r.notified).toEqual([])
    expect(conv.countEvents(C, 'handoff')).toBe(1)
    expect(conv.getState(C).status).toBe('menunggu_admin')
  })
  it('returns a farewell without placeholders, adding the outside-hours note when closed', async () => {
    const { clock, svc } = setup()
    const open = await svc.trigger({ profile: profile(), chatId: C, reason: 'komplain', productName: null })
    expect(open.farewell).not.toMatch(/\{[a-z_]+\}/)
    expect(open.farewell).toContain('Senin–Jumat')
    clock.t = sundayWita(12)
    const closed = await svc.trigger({ profile: profile(), chatId: '6281777@s.whatsapp.net', reason: 'komplain', productName: null })
    expect(closed.farewell).toMatch(/di luar jam kerja/i)
    expect(closed.farewell).not.toMatch(/\{[a-z_]+\}/)
  })
  it('pauses for the configured number of hours', async () => {
    const { clock, conv, svc } = setup()
    const p = profile()
    p.limits.pauseHours = 2
    await svc.trigger({ profile: p, chatId: C, reason: 'komplain', productName: null })
    clock.t += 2 * 3_600_000 + 1
    expect(conv.isPaused(C)).toBe(false)
  })
})

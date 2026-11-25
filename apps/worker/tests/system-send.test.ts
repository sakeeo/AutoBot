import { describe, it, expect } from 'vitest'
import { openDb } from '../src/db'
import { renderSystemText, SystemSender, SYSTEM_LIMITS, type SystemSendRequest } from '../src/system-send'
import { FakeGateway } from './helpers/fake-gateway'

const OWNER = '6281234567890'

function setup(opts: { connected?: boolean } = {}) {
  const db = openDb(':memory:')
  const gateway = new FakeGateway()
  const clock = { t: 1_700_000_000_000, now() { return this.t } }
  const logs: unknown[] = []
  const delivered: { chatId: string; text: string }[] = []
  const build = () => new SystemSender({
    db, gateway, clock,
    isConnected: () => opts.connected ?? true,
    deliver: async (chatId, text) => { delivered.push({ chatId, text }); return 'id' },
    log: (i) => logs.push(i)
  })
  return { db, gateway, clock, logs, delivered, sender: build(), build }
}
const otp = (o: Partial<SystemSendRequest> = {}): SystemSendRequest => ({ to: OWNER, kind: 'otp_setup', code: '482913', ...o })

describe('renderSystemText', () => {
  it('builds each message from its kind, with the code and the purpose', () => {
    const now = 1_700_000_000_000
    expect(renderSystemText(otp(), now)).toBe('AutoBot — kode verifikasi nomor pemilik: 482913. Berlaku 5 menit.')
    expect(renderSystemText(otp({ kind: 'otp_reset' }), now)).toContain('RESET PASSWORD: 482913')
    expect(renderSystemText(otp({ kind: 'otp_change_phone' }), now)).toContain('nomor baru: 482913')
    expect(renderSystemText({ to: OWNER, kind: 'notice_password_changed', username: 'budi' }, now)).toContain('akun "budi" diubah')
    expect(renderSystemText({ to: OWNER, kind: 'notice_phone_changed', last4: '7890' }, now)).toContain('••••7890')
  })
  it('refuses malformed requests: a code that is not six digits, a missing or hostile username, a bad last4', () => {
    expect(renderSystemText(otp({ code: '12345' }), 0)).toBeNull()
    expect(renderSystemText(otp({ code: '12345a' }), 0)).toBeNull()
    expect(renderSystemText(otp({ code: undefined }), 0)).toBeNull()
    expect(renderSystemText({ to: OWNER, kind: 'notice_password_changed' }, 0)).toBeNull()
    expect(renderSystemText({ to: OWNER, kind: 'notice_phone_changed', last4: '78' }, 0)).toBeNull()
    expect(renderSystemText({ ...otp(), kind: 'free_text' as never }, 0)).toBeNull()
  })
  it('strips anything but plain characters from a username, so a name cannot smuggle a link or markup', () => {
    const t = renderSystemText({ to: OWNER, kind: 'notice_password_changed', username: 'budi\nhttps://x.co <b>' }, 0)!
    expect(t).not.toContain('\n')
    expect(t).not.toContain('<')
    expect(t).not.toContain('https://')
  })
})

describe('SystemSender', () => {
  it('checks the number is on WhatsApp, delivers the text and reports ok', async () => {
    const t = setup()
    expect(await t.sender.send(otp())).toEqual({ ok: true })
    expect(t.delivered).toEqual([{ chatId: `${OWNER}@s.whatsapp.net`, text: expect.stringContaining('482913') }])
  })
  it('rejects bad numbers, unknown kinds and malformed codes without sending', async () => {
    const t = setup()
    expect(await t.sender.send(otp({ to: '0812345' }))).toEqual({ ok: false, code: 'INVALID_NUMBER' })
    expect(await t.sender.send(otp({ to: '+6281234567890' }))).toEqual({ ok: false, code: 'INVALID_NUMBER' })
    expect(await t.sender.send(otp({ code: 'abc' }))).toEqual({ ok: false, code: 'BAD_REQUEST' })
    expect(await t.sender.send({ ...otp(), kind: 'x' as never })).toEqual({ ok: false, code: 'BAD_REQUEST' })
    expect(t.delivered).toEqual([])
  })
  it('reports a number that is not on WhatsApp, and sends nothing', async () => {
    const t = setup()
    t.gateway.registered = new Set(['6289999999999'])
    expect(await t.sender.send(otp())).toEqual({ ok: false, code: 'NOT_ON_WHATSAPP' })
    expect(t.delivered).toEqual([])
  })
  it('reports WA_DISCONNECTED when WhatsApp is not connected, and does not use up the limit', async () => {
    const t = setup({ connected: false })
    expect(await t.sender.send(otp())).toEqual({ ok: false, code: 'WA_DISCONNECTED' })
    expect(t.db.prepare('SELECT COUNT(*) AS c FROM system_send_log').get()).toEqual({ c: 0 })
  })
  it('sends to the bot\'s own number without asking WhatsApp whether it exists', async () => {
    const t = setup()
    let asked = false
    t.gateway.onWhatsApp = async () => { asked = true; return [] }
    expect(await t.sender.send(otp({ to: t.gateway.self! }))).toEqual({ ok: true })
    expect(asked).toBe(false)
  })
  it(`stops at ${SYSTEM_LIMITS.perHour} messages an hour, and the next one goes out after the hour`, async () => {
    const t = setup()
    for (let i = 0; i < SYSTEM_LIMITS.perHour; i++) expect(await t.sender.send(otp())).toEqual({ ok: true })
    expect(await t.sender.send(otp())).toEqual({ ok: false, code: 'RATE_LIMITED' })
    expect(t.delivered).toHaveLength(SYSTEM_LIMITS.perHour)
    t.clock.t += 3_600_001
    expect(await t.sender.send(otp())).toEqual({ ok: true })
  })
  it(`stops at ${SYSTEM_LIMITS.perDay} messages a day`, async () => {
    const t = setup()
    let sent = 0
    for (let h = 0; h < 6; h++) {
      for (let i = 0; i < SYSTEM_LIMITS.perHour; i++) { if ((await t.sender.send(otp())).ok) sent++ }
      t.clock.t += 3_600_001
    }
    expect(sent).toBe(SYSTEM_LIMITS.perDay)
  })
  it('keeps counting across a restart, because the log is in the database', async () => {
    const t = setup()
    for (let i = 0; i < SYSTEM_LIMITS.perHour; i++) await t.sender.send(otp())
    const reborn = t.build() // a new sender on the same database, as after a restart
    expect(await reborn.send(otp())).toEqual({ ok: false, code: 'RATE_LIMITED' })
  })
  it('counts a send that failed halfway', async () => {
    const t = setup()
    const failing = new SystemSender({
      db: t.db, gateway: t.gateway, clock: t.clock, isConnected: () => true,
      deliver: async () => { throw new Error('boom') }
    })
    expect(await failing.send(otp())).toEqual({ ok: false, code: 'WA_DISCONNECTED' })
    expect(t.db.prepare('SELECT COUNT(*) AS c FROM system_send_log').get()).toEqual({ c: 1 })
  })
  it('never writes the code or the text to the log, the database, or the result', async () => {
    const t = setup()
    const r = await t.sender.send(otp({ code: '918273' }))
    expect(JSON.stringify([t.logs, r])).not.toContain('918273')
    expect(JSON.stringify(t.logs)).not.toContain(OWNER) // the number is masked
    const rows = t.db.prepare('SELECT * FROM system_send_log').all()
    expect(JSON.stringify(rows)).not.toContain('918273')
    expect(Object.keys(rows[0] as object).sort()).toEqual(['at', 'id', 'kind'])
  })
})

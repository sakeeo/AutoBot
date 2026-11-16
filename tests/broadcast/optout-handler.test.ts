import { describe, it, expect } from 'vitest'
import { openDb } from '../../src/main/db'
import { BroadcastStore } from '../../src/main/broadcast/store'
import { OptOutHandler } from '../../src/main/broadcast/optout-handler'
import { START_CONFIRMATION, STOP_CONFIRMATION } from '../../src/main/broadcast/optout'
import type { IncomingMessage } from '../../src/shared/types'

const NUM = '6281234567890'
const JID = `${NUM}@s.whatsapp.net`

function setup(opts: { broadcastTo?: boolean; human?: boolean } = {}) {
  const db = openDb(':memory:')
  const clock = { t: 1_700_000_000_000, now() { return this.t } }
  const store = new BroadcastStore(db, clock)
  const replies: { chatId: string; text: string }[] = []
  const signals: string[] = []
  const flags = { broadcastTo: opts.broadcastTo ?? true, human: opts.human ?? false }
  const handler = new OptOutHandler({
    store, clock,
    wasBroadcastTo: () => flags.broadcastTo,
    reply: async (chatId, text) => { replies.push({ chatId, text }) },
    isHumanHandling: () => flags.human,
    onSignal: (k) => signals.push(k)
  })
  let n = 0
  const msg = (text: string | null, o: Partial<IncomingMessage> = {}): IncomingMessage => ({
    id: `w${++n}`, chatId: JID, sender: JID, isGroup: false, fromMe: false, text, timestamp: clock.now(), ...o
  })
  return { store, clock, replies, signals, flags, handler, msg }
}

describe('OptOutHandler: stop', () => {
  it('suppresses someone who was broadcast to, confirms once and keeps the message from the agent', async () => {
    const t = setup()
    expect(await t.handler.handle(t.msg('BERHENTI'))).toBe(true)
    expect(t.store.isSuppressed({ number: NUM })?.reason).toBe('berhenti')
    expect(t.replies).toEqual([{ chatId: JID, text: STOP_CONFIRMATION }])
    expect(t.signals).toEqual(['optout'])
  })
  it('does not confirm a second time for someone already opted out', async () => {
    const t = setup()
    await t.handler.handle(t.msg('stop'))
    expect(await t.handler.handle(t.msg('stop'))).toBe(true)
    expect(t.replies).toHaveLength(1)
    expect(t.signals).toEqual(['optout'])
  })
  it('records a soft suppression for someone never broadcast to, stays silent, and lets the agent answer', async () => {
    const t = setup({ broadcastTo: false })
    expect(await t.handler.handle(t.msg('stop'))).toBe(false)
    expect(t.store.isSuppressed({ number: NUM })?.reason).toBe('tolak_lunak')
    expect(t.replies).toEqual([])
    expect(t.signals).toEqual([])
  })
  it('records the opt-out silently while a human is handling the chat', async () => {
    const t = setup({ human: true })
    expect(await t.handler.handle(t.msg('berhenti'))).toBe(true)
    expect(t.store.isSuppressed({ number: NUM })?.reason).toBe('berhenti')
    expect(t.replies).toEqual([])
  })
  it('works for a lid chat that has no phone number', async () => {
    const t = setup()
    await t.handler.handle(t.msg('stop', { chatId: 'abc123@lid' }))
    expect(t.store.isSuppressed({ jid: 'abc123@lid' })?.reason).toBe('berhenti')
  })
})

describe('OptOutHandler: start', () => {
  it('lifts an opt-out the person made themselves', async () => {
    const t = setup()
    await t.handler.handle(t.msg('stop'))
    t.replies.length = 0
    expect(await t.handler.handle(t.msg('MULAI'))).toBe(true)
    expect(t.store.isSuppressed({ number: NUM })).toBeNull()
    expect(t.replies).toEqual([{ chatId: JID, text: START_CONFIRMATION }])
  })
  it('never lifts a complaint, an admin entry or a soft suppression', async () => {
    for (const reason of ['laporan', 'admin', 'tolak_lunak', 'blokir_manual'] as const) {
      const t = setup()
      t.store.suppress({ number: NUM, jid: JID, reason })
      expect(await t.handler.handle(t.msg('mulai'))).toBe(false)
      expect(t.store.isSuppressed({ number: NUM })?.reason, reason).toBe(reason)
      expect(t.replies).toEqual([])
    }
  })
  it('treats "mulai" from someone who is not suppressed as ordinary chat', async () => {
    const t = setup()
    expect(await t.handler.handle(t.msg('mulai'))).toBe(false)
    expect(t.replies).toEqual([])
  })
})

describe('OptOutHandler: complaints and replies', () => {
  it('a complaint from a broadcast recipient suppresses them, raises the signal and is not answered by the bot', async () => {
    const t = setup()
    expect(await t.handler.handle(t.msg('ini spam!'))).toBe(true)
    expect(t.store.isSuppressed({ number: NUM })?.reason).toBe('laporan')
    expect(t.signals).toEqual(['complaint'])
    expect(t.replies).toEqual([])
  })
  it('a complaint from a stranger is suppressed softly but still reaches the agent', async () => {
    const t = setup({ broadcastTo: false })
    expect(await t.handler.handle(t.msg('apakah ini penipuan'))).toBe(false)
    expect(t.store.isSuppressed({ number: NUM })).not.toBeNull()
  })
  it('an ordinary reply from a pending imported contact activates them and signals a reply', async () => {
    const t = setup()
    t.store.upsertContact({ number: NUM, jid: JID, source: 'impor', status: 'menunggu_persetujuan' })
    expect(await t.handler.handle(t.msg('ya boleh'))).toBe(false)
    expect(t.store.findContact({ number: NUM })?.status).toBe('aktif')
    expect(t.signals).toEqual(['reply'])
  })
})

describe('OptOutHandler: what it ignores', () => {
  it('ignores groups, own messages, broadcast lists, stale and non-text messages', async () => {
    const t = setup()
    expect(await t.handler.handle(t.msg('stop', { isGroup: true, chatId: '99@g.us' }))).toBe(false)
    expect(await t.handler.handle(t.msg('stop', { fromMe: true }))).toBe(false)
    expect(await t.handler.handle(t.msg('stop', { chatId: 'status@broadcast' }))).toBe(false)
    expect(await t.handler.handle(t.msg('stop', { timestamp: t.clock.now() - 10 * 60_000 }))).toBe(false)
    expect(await t.handler.handle(t.msg(null))).toBe(false)
    expect(t.store.listSuppressed()).toEqual([])
    expect(t.replies).toEqual([])
  })
})

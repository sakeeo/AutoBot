import { describe, it, expect } from 'vitest'
import { openDb, type Db } from '../../src/main/db'
import { BroadcastStore } from '../../src/main/broadcast/store'

function setup(db: Db = openDb(':memory:')) {
  const clock = { t: 1_700_000_000_000, now() { return this.t } }
  return { db, clock, store: new BroadcastStore(db, clock) }
}
const chat = { source: 'chat' as const, status: 'aktif' as const }
const imp = { source: 'impor' as const, status: 'menunggu_persetujuan' as const }

describe('BroadcastStore contacts', () => {
  it('treats the same number in any format as one contact', () => {
    const { store, db } = setup()
    const a = store.upsertContact({ number: '0812-3456-7890', jid: null, ...imp })
    const b = store.upsertContact({ number: '+62 812 3456 7890', jid: null, ...imp })
    const c = store.upsertContact({ number: '6281234567890', jid: '6281234567890@s.whatsapp.net', ...chat })
    expect(new Set([a.id, b.id, c.id]).size).toBe(1)
    expect(db.prepare('SELECT COUNT(*) AS n FROM broadcast_contacts').get()).toEqual({ n: 1 })
    expect(store.findContact({ jid: '6281234567890@s.whatsapp.net' })?.number).toBe('6281234567890')
  })
  it('keeps a lid-only chat contact with no number', () => {
    const { store } = setup()
    const c = store.upsertContact({ number: null, jid: 'abc@lid', ...chat })
    expect(c.number).toBeNull()
    expect(store.findContact({ jid: 'abc@lid' })?.id).toBe(c.id)
  })
  it('never downgrades an existing contact when the same number is imported', () => {
    const { store } = setup()
    store.upsertContact({ number: '628111111111', jid: '628111111111@s.whatsapp.net', ...chat })
    const again = store.upsertContact({ number: '628111111111', jid: null, ...imp, name: 'Budi' })
    expect(again.status).toBe('aktif')
    expect(again.source).toBe('chat')
    expect(again.name).toBe('Budi')
  })
  it('recordInbound activates a pending contact and stamps the time, but leaves tidak_aktif alone', () => {
    const { store } = setup()
    const p = store.upsertContact({ number: '628111111111', jid: null, ...imp })
    expect(store.recordInbound({ number: '628111111111' }, 1234)).toMatchObject({ status: 'aktif', lastInboundAt: 1234 })
    const d = store.upsertContact({ number: '628222222222', jid: null, source: 'impor', status: 'tidak_aktif' })
    expect(store.recordInbound({ number: '628222222222' }, 99)!.status).toBe('tidak_aktif')
    expect(store.recordInbound({ number: '629999999999' }, 1)).toBeNull()
    expect(p.id).not.toBe(d.id)
  })
})

describe('BroadcastStore suppression', () => {
  it('matches by number, by jid and by the same number in another format', () => {
    const { store } = setup()
    store.suppress({ number: '6281234567890', jid: null, reason: 'berhenti' })
    store.suppress({ number: null, jid: 'xyz@lid', reason: 'laporan' })
    expect(store.isSuppressed({ number: '0812-3456-7890' })?.reason).toBe('berhenti')
    expect(store.isSuppressed({ jid: '6281234567890@s.whatsapp.net' })?.reason).toBe('berhenti')
    expect(store.isSuppressed({ jid: 'xyz@lid' })?.reason).toBe('laporan')
    expect(store.isSuppressed({ number: '6289999999999' })).toBeNull()
  })
  it('unsuppress lifts it and listSuppressed shows what is blocked', () => {
    const { store } = setup()
    store.suppress({ number: '628111111111', jid: null, reason: 'berhenti' })
    expect(store.listSuppressed()).toHaveLength(1)
    store.unsuppress({ number: '628111111111' })
    expect(store.isSuppressed({ number: '628111111111' })).toBeNull()
    expect(store.listSuppressed()).toHaveLength(0)
  })
  it('suppressing twice keeps one entry', () => {
    const { store } = setup()
    store.suppress({ number: '628111111111', jid: null, reason: 'tolak_lunak' })
    store.suppress({ number: '628111111111', jid: null, reason: 'berhenti' })
    expect(store.listSuppressed()).toHaveLength(1)
    expect(store.isSuppressed({ number: '628111111111' })?.reason).toBe('berhenti')
  })
})

describe('BroadcastStore.eraseContact', () => {
  it('removes everything about an ordinary contact', () => {
    const { store, db } = setup()
    const c = store.upsertContact({ number: '628111111111', jid: '628111111111@s.whatsapp.net', name: 'Budi', ...chat })
    db.prepare("INSERT INTO messages(wa_id, chat_id, direction, text, is_group, created_at) VALUES ('in:1','628111111111@s.whatsapp.net','in','halo',0,1)").run()
    store.eraseContact(c.id)
    expect(store.findContact({ number: '628111111111' })).toBeNull()
    expect(db.prepare('SELECT COUNT(*) AS n FROM messages').get()).toEqual({ n: 0 })
    expect(store.listSuppressed()).toHaveLength(0)
  })
  it('keeps only a hashed tombstone for someone who opted out, so a re-import stays blocked', () => {
    const { store, db } = setup()
    const c = store.upsertContact({ number: '6281234567890', jid: '6281234567890@s.whatsapp.net', name: 'Budi', ...chat })
    store.suppress({ number: '6281234567890', jid: '6281234567890@s.whatsapp.net', reason: 'berhenti' })
    store.eraseContact(c.id)
    expect(store.findContact({ number: '6281234567890' })).toBeNull()
    expect(store.isSuppressed({ number: '0812-3456-7890' })?.reason).toBe('berhenti')
    expect(store.isSuppressed({ jid: '6281234567890@s.whatsapp.net' })).not.toBeNull()
    const raw = JSON.stringify(db.prepare('SELECT * FROM broadcast_suppress').all())
    expect(raw).not.toContain('6281234567890')
  })
})

describe('BroadcastStore salt', () => {
  it('is created once, stable across instances, and stored only in broadcast_state', () => {
    const { store, db } = setup()
    const salt = store.salt()
    expect(salt).toMatch(/^[0-9a-f]{32}$/)
    expect(new BroadcastStore(db, { now: () => 1 }).salt()).toBe(salt)
    store.suppress({ number: '628111111111', jid: null, reason: 'berhenti' })
    expect(JSON.stringify(db.prepare('SELECT * FROM broadcast_suppress').all())).not.toContain(salt)
  })
})

describe('BroadcastStore: stronger reasons win', () => {
  it('never replaces a complaint, admin or manual block with a weaker reason', () => {
    const { store } = setup()
    store.suppress({ number: '628111111111', jid: null, reason: 'laporan' })
    store.suppress({ number: '628111111111', jid: null, reason: 'berhenti' })
    expect(store.isSuppressed({ number: '628111111111' })?.reason).toBe('laporan')
    store.suppress({ number: '628222222222', jid: null, reason: 'tolak_lunak' })
    store.suppress({ number: '628222222222', jid: null, reason: 'berhenti' })
    expect(store.isSuppressed({ number: '628222222222' })?.reason).toBe('berhenti')
    store.suppress({ number: '628222222222', jid: null, reason: 'admin' })
    expect(store.isSuppressed({ number: '628222222222' })?.reason).toBe('admin')
  })
  it('unsuppress with a reason removes only entries of that reason', () => {
    const { store } = setup()
    store.suppress({ number: '628111111111', jid: null, reason: 'admin' })
    store.unsuppress({ number: '628111111111' }, 'berhenti')
    expect(store.isSuppressed({ number: '628111111111' })?.reason).toBe('admin')
    store.suppress({ number: '628333333333', jid: null, reason: 'berhenti' })
    store.unsuppress({ number: '628333333333' }, 'berhenti')
    expect(store.isSuppressed({ number: '628333333333' })).toBeNull()
  })
})

describe('BroadcastStore: erasing a contact', () => {
  const sendOne = (db: Db, store: BroadcastStore, contactId: number, at: number) => {
    const c = store.createCampaign({ name: 'x', kind: 'broadcast', template: 'Halo {bisnis}', audience: 'semua' })
    const r = db.prepare("INSERT INTO broadcast_sends(campaign_id, contact_id, status, sent_at, created_at) VALUES (?, ?, 'terkirim', ?, ?)").run(c.id, contactId, at, at)
    return Number(r.lastInsertRowid)
  }
  it('keeps what was already sent in the counters, so erasing cannot buy extra sends', () => {
    const { store, db, clock } = setup()
    const c = store.upsertContact({ number: '628111111111', jid: '628111111111@s.whatsapp.net', ...chat })
    sendOne(db, store, c.id, clock.now() - 1000)
    const before = store.counters(clock.now(), 'Asia/Makassar')
    store.eraseContact(c.id)
    const after = store.counters(clock.now(), 'Asia/Makassar')
    expect(after.sentToday).toBe(before.sentToday)
    expect(after.sentThisHour).toBe(before.sentThisHour)
    expect(after.newToday).toBe(before.newToday)
    expect(after.sendDays).toEqual(before.sendDays)
    const rows = db.prepare('SELECT contact_id FROM broadcast_sends').all()
    expect(rows).toEqual([{ contact_id: 0 }])
  })
  it('drops queued sends for the erased person', () => {
    const { store, db } = setup()
    const c = store.upsertContact({ number: '628111111111', jid: null, ...chat })
    const camp = store.createCampaign({ name: 'x', kind: 'broadcast', template: 'Halo {bisnis}', audience: 'semua' })
    store.enqueue(camp.id)
    store.eraseContact(c.id)
    expect(db.prepare("SELECT COUNT(*) AS n FROM broadcast_sends WHERE status = 'antre'").get()).toEqual({ n: 0 })
  })
  it('also removes their conversation text and history from the other tables', () => {
    const { store, db } = setup()
    const jid = '628111111111@s.whatsapp.net'
    const c = store.upsertContact({ number: '628111111111', jid, ...chat })
    db.prepare("INSERT INTO turns(chat_id, role, text, created_at) VALUES (?, 'user', 'rahasia', 1)").run(jid)
    db.prepare("INSERT INTO handoffs(chat_id, reason, created_at) VALUES (?, 'komplain', 1)").run(jid)
    db.prepare("INSERT INTO contacts(chat_id) VALUES (?)").run(jid)
    db.prepare("INSERT INTO events(chat_id, type, created_at) VALUES (?, 'handoff', 1)").run(jid)
    db.prepare("INSERT INTO cooldowns(chat_id, last_at) VALUES (?, 1)").run(jid)
    db.prepare("INSERT INTO contact_memory(chat_id, summary) VALUES (?, 'rahasia')").run(jid)
    store.eraseContact(c.id)
    for (const t of ['turns', 'handoffs', 'contacts', 'events', 'cooldowns', 'contact_memory'])
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get(), t).toEqual({ n: 0 })
  })
})

describe('BroadcastStore: pending confirmations and in-flight sends', () => {
  it('retires a pending contact who did not answer a confirmation within 7 days', () => {
    const { store, db, clock } = setup()
    const a = store.upsertContact({ number: '628111111111', jid: null, ...imp })
    const b = store.upsertContact({ number: '628222222222', jid: null, ...imp })
    const camp = store.createCampaign({ name: 'k', kind: 'konfirmasi', template: 'Halo {bisnis}', audience: 'impor' })
    const ins = db.prepare("INSERT INTO broadcast_sends(campaign_id, contact_id, status, sent_at, created_at) VALUES (?, ?, 'terkirim', ?, ?)")
    ins.run(camp.id, a.id, clock.now() - 8 * 86_400_000, 1)
    ins.run(camp.id, b.id, clock.now() - 2 * 86_400_000, 1)
    store.expirePending(clock.now())
    expect(store.findContact({ number: '628111111111' })!.status).toBe('tidak_aktif')
    expect(store.findContact({ number: '628222222222' })!.status).toBe('menunggu_persetujuan')
  })
  it('a send marked as in flight is never queued again, and a restart counts it as sent', () => {
    const { store, db, clock } = setup()
    const c = store.upsertContact({ number: '628111111111', jid: null, ...chat })
    const camp = store.createCampaign({ name: 'x', kind: 'broadcast', template: 'Halo {bisnis}', audience: 'semua' })
    store.enqueue(camp.id)
    const q = store.nextQueued(camp.id)!
    store.markSending(q.sendId)
    expect(store.nextQueued(camp.id)).toBeNull()
    store.settleInterrupted(clock.now())
    expect(db.prepare('SELECT status, reason FROM broadcast_sends').get()).toEqual({ status: 'terkirim', reason: 'tidak_pasti' })
    expect(store.counters(clock.now(), 'Asia/Makassar').sentToday).toBe(1)
    expect(c.id).toBeGreaterThan(0)
  })
  it('recentOutcomes marks whether the person answered after being messaged', () => {
    const { store, db, clock } = setup()
    const a = store.upsertContact({ number: '628111111111', jid: null, ...imp })
    const b = store.upsertContact({ number: '628222222222', jid: null, ...imp })
    const camp = store.createCampaign({ name: 'x', kind: 'broadcast', template: 'Halo {bisnis}', audience: 'impor' })
    const ins = db.prepare("INSERT INTO broadcast_sends(campaign_id, contact_id, status, sent_at, created_at) VALUES (?, ?, 'terkirim', ?, ?)")
    ins.run(camp.id, a.id, 5_000, 5_000)
    ins.run(camp.id, b.id, 6_000, 6_000)
    db.prepare('UPDATE broadcast_contacts SET last_inbound_at = 1000 WHERE id = ?').run(a.id) // answered an earlier campaign
    db.prepare('UPDATE broadcast_contacts SET last_inbound_at = 7000 WHERE id = ?').run(b.id)
    expect(store.recentOutcomes(30, 0).map((o) => o.replied)).toEqual([false, true])
    expect(clock.now()).toBeGreaterThan(0)
  })
  it('deletes a draft campaign but never one that has started', () => {
    const { store } = setup()
    const draft = store.createCampaign({ name: 'd', kind: 'broadcast', template: 'Halo {bisnis}', audience: 'semua' })
    const live = store.createCampaign({ name: 'l', kind: 'broadcast', template: 'Halo {bisnis}', audience: 'semua' })
    store.setCampaignStatus(live.id, 'berjalan')
    expect(store.deleteDraft(draft.id)).toBe(true)
    expect(store.deleteDraft(live.id)).toBe(false)
    expect(store.getCampaign(draft.id)).toBeNull()
    expect(store.getCampaign(live.id)).not.toBeNull()
  })
})

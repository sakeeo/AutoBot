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

import { describe, it, expect } from 'vitest'
import { openDb } from '../src/db'
import { BrandStore } from '../src/brand-store'
import { PRESETS, type BrandProfile } from '@autobot/contracts/brand'

const clock = { t: 1_700_000_000_000, now() { return this.t } }
const make = (botNumber: string | null = '6281200009999') =>
  new BrandStore(openDb(':memory:'), clock, () => ({ botNumber, productCount: 0 }))
const profile = (over: Partial<BrandProfile> = {}): BrandProfile => ({
  ...structuredClone(PRESETS.kustom), identity: { ...PRESETS.kustom.identity, businessName: 'Toko Uji' }, ...over
})

describe('BrandStore', () => {
  it('starts with the kustom preset at version 0', () => {
    const s = make()
    expect(s.getActive().version).toBe(0)
    expect(s.getActive().preset).toBe('kustom')
    expect(s.getDraft()).toEqual(s.getActive())
  })
  it('saves a draft without touching the active profile, then applies it as a new version', () => {
    const s = make()
    expect(s.saveDraft(profile()).ok).toBe(true)
    expect(s.getActive().identity.businessName).toBe('')
    const r = s.apply()
    expect(r).toMatchObject({ ok: true, version: 1 })
    expect(s.getActive().identity.businessName).toBe('Toko Uji')
    expect(s.getActive().version).toBe(1)
  })
  it('refuses to apply when validation finds errors and keeps the active version', () => {
    const s = make()
    const bad = profile({ admins: [{ id: 'a', name: 'Bot', number: '0812-0000-9999', notifyWhatsapp: true }] })
    expect(s.saveDraft(bad).ok).toBe(true)
    const r = s.apply()
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.level === 'error')).toBe(true)
    expect(s.getActive().version).toBe(0)
  })
  it('rejects a draft that does not match the schema', () => {
    const s = make()
    const r = s.saveDraft({ ...profile(), evil: 1 })
    expect(r.ok).toBe(false)
    expect(s.getDraft().identity.businessName).toBe('')
  })
  it('keeps only the 20 newest versions', () => {
    const s = make()
    for (let i = 0; i < 22; i++) {
      s.saveDraft(profile({ identity: { ...profile().identity, businessName: `V${i}` } }))
      clock.t += 1000
      expect(s.apply().ok).toBe(true)
    }
    const v = s.listVersions()
    expect(v).toHaveLength(20)
    expect(v[0].version).toBe(22)
    expect(v[19].version).toBe(3)
  })
  it('restores an old version as a new applied version with the same content', () => {
    const s = make()
    s.saveDraft(profile({ identity: { ...profile().identity, businessName: 'Satu' } }))
    s.apply()
    s.saveDraft(profile({ identity: { ...profile().identity, businessName: 'Dua' } }))
    s.apply()
    const restored = s.restore(1)
    expect(restored.identity.businessName).toBe('Satu')
    expect(s.getActive().identity.businessName).toBe('Satu')
    expect(s.getActive().version).toBe(3)
  })
  it('exports and re-imports the same profile', () => {
    const s = make()
    s.saveDraft(profile())
    s.apply()
    const json = s.exportJson()
    const s2 = make()
    expect(s2.importJson(json).ok).toBe(true)
    expect(s2.getDraft()).toEqual(s.getActive())
  })
  it('rejects broken or foreign json on import without touching the draft', () => {
    const s = make()
    const before = s.getDraft()
    expect(s.importJson('{bad').ok).toBe(false)
    expect(s.importJson(JSON.stringify({ ...profile(), evil: true })).ok).toBe(false)
    expect(s.importJson(JSON.stringify([1, 2])).ok).toBe(false)
    expect(s.getDraft()).toEqual(before)
  })
  it('export never contains secrets', () => {
    const s = make()
    expect(s.exportJson()).not.toMatch(/api[_-]?key|secret|password/i)
  })
})

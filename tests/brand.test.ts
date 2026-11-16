import { describe, it, expect } from 'vitest'
import {
  BrandProfileSchema, PRESETS, normalizeNumber, validateProfile,
  type BrandProfile, type ValidateCtx
} from '../src/shared/brand'

const ctx: ValidateCtx = { botNumber: '6285119308345', productCount: 0 }
const clone = <T,>(x: T): T => structuredClone(x)
const toko = (): BrandProfile => clone(PRESETS.toko_online)
const jasa = (): BrandProfile => clone(PRESETS.jasa_agensi)
const link = (o: Partial<BrandProfile['links'][number]> = {}) => ({
  id: 'l1', name: 'Checkout', kind: 'checkout' as const, url: 'https://toko.example/checkout', tracking: true, ...o
})
const admin = (o: Partial<BrandProfile['admins'][number]> = {}) => ({
  id: 'a1', name: 'Budi', number: '6281234567890', notifyWhatsapp: true, ...o
})
const errors = (p: BrandProfile, c = ctx) => validateProfile(p, c).filter((i) => i.level === 'error')

describe('normalizeNumber', () => {
  it('keeps digits only and turns a leading 0 into 62', () => {
    expect(normalizeNumber('0851-1930-8345')).toBe('6285119308345')
    expect(normalizeNumber('+62 851 1930 8345')).toBe('6285119308345')
    expect(normalizeNumber('6285119308345')).toBe('6285119308345')
    expect(normalizeNumber('')).toBe('')
  })
})

describe('presets', () => {
  it('every preset satisfies the schema', () => {
    for (const [id, p] of Object.entries(PRESETS))
      expect(BrandProfileSchema.safeParse(p).success, id).toBe(true)
  })
  it('toko_online sets a product business with the checkout goal and starter rules', () => {
    const p = toko()
    expect(p.businessType).toBe('produk')
    expect(p.goal).toBe('checkout')
    expect(p.rules.some((r) => r.when.intents?.includes('komplain') && r.then.action === 'handoff')).toBe(true)
    expect(p.rules.some((r) => r.when.intents?.includes('siap_beli') && r.then.action === 'send_checkout')).toBe(true)
  })
  it('jasa_agensi sets a service business with six starter rules ending in handoff behaviour', () => {
    const p = jasa()
    expect(p.businessType).toBe('jasa')
    expect(p.rules).toHaveLength(6)
    expect(p.rules[0].then.action).toBe('handoff')
  })
  it('rejects unknown properties', () => {
    expect(BrandProfileSchema.safeParse({ ...toko(), evil: true }).success).toBe(false)
  })
})

describe('validateProfile', () => {
  it('errors when an admin number equals the bot number in any format', () => {
    for (const n of ['6285119308345', '0851-1930-8345', '+62 851 1930 8345']) {
      const p = jasa()
      p.admins = [admin({ number: n })]
      expect(errors(p).some((i) => i.field.startsWith('admins'))).toBe(true)
    }
  })
  it('accepts a different admin number', () => {
    const p = jasa()
    p.admins = [admin()]
    expect(errors(p)).toEqual([])
  })
  it('errors on a checkout goal with no checkout link and no products', () => {
    expect(errors(toko()).some((i) => i.field === 'goal')).toBe(true)
  })
  it('is valid once a checkout link exists', () => {
    const p = toko()
    p.links = [link()]
    expect(errors(p)).toEqual([])
  })
  it('is valid when the catalog has products instead of a link', () => {
    expect(errors(toko(), { botNumber: null, productCount: 3 })).toEqual([])
  })
  it('errors on non-https urls', () => {
    const p = toko()
    p.links = [link({ url: 'http://toko.example/checkout' })]
    expect(errors(p).some((i) => i.field === 'links[0].url')).toBe(true)
  })
  it('errors when a rule points to a missing link or admin', () => {
    const p = toko()
    p.links = [link()]
    p.rules = [{ id: 'r', enabled: true, when: { intents: ['siap_beli'] }, then: { action: 'send_link', linkId: 'nope' } }]
    expect(errors(p).some((i) => i.field === 'rules[0].then.linkId')).toBe(true)
    p.rules = [{ id: 'r', enabled: true, when: {}, then: { action: 'handoff', adminId: 'ghost' } }]
    expect(errors(p).some((i) => i.field === 'rules[0].then.adminId')).toBe(true)
  })
  it('warns when a rule uses working hours but every day is closed', () => {
    const p = jasa()
    p.admins = [admin()]
    p.hours.days = { '0': null, '1': null, '2': null, '3': null, '4': null, '5': null, '6': null }
    p.rules = [{ id: 'r', enabled: true, when: { withinHours: false }, then: { action: 'reply_only' } }]
    const w = validateProfile(p, ctx).filter((i) => i.level === 'warn')
    expect(w.some((i) => i.field === 'hours')).toBe(true)
  })
})

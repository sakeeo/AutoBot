import { describe, it, expect } from 'vitest'
import { evaluateRules, forcedHandoffReason, type RuleFacts } from '../src/main/policy/rules'
import { PRESETS, type BrandProfile, type Rule } from '../src/shared/brand'

const facts = (o: Partial<RuleFacts> = {}): RuleFacts => ({
  intent: 'tanya_produk', suggested: 'none', message: 'ada paket apa saja?', productId: null, withinHours: true,
  turns: 1, leadComplete: false, confidence: 0.9, lowConfidenceStreak: 0, turnsWithoutProgress: 0,
  ruleCounts: {}, checkoutAvailable: true, ...o
})
const withRules = (rules: Rule[], over: Partial<BrandProfile> = {}): BrandProfile => ({
  ...structuredClone(PRESETS.toko_online), rules, ...over
})
const r = (id: string, when: Rule['when'], action: Rule['then']['action'], extra: Partial<Rule> = {}): Rule => ({
  id, enabled: true, when, then: { action }, ...extra
})

describe('forcedHandoffReason', () => {
  it('forces handoff for explicit human requests and complaints', () => {
    expect(forcedHandoffReason(facts({ intent: 'minta_manusia' }))).toBe('minta_manusia')
    expect(forcedHandoffReason(facts({ intent: 'komplain' }))).toBe('komplain')
  })
  it('forces handoff for sensitive keywords whatever the intent', () => {
    for (const m of ['saya mau refund', 'tagihan saya salah', 'ini penipuan ya', 'minta ganti rugi'])
      expect(forcedHandoffReason(facts({ message: m })), m).toBe('kata_kunci_sensitif')
  })
  it('forces handoff on the second consecutive low-confidence turn only', () => {
    expect(forcedHandoffReason(facts({ confidence: 0.3, lowConfidenceStreak: 0 }))).toBeNull()
    expect(forcedHandoffReason(facts({ confidence: 0.3, lowConfidenceStreak: 1 }))).toBe('keyakinan_rendah')
    expect(forcedHandoffReason(facts({ confidence: 0.9, lowConfidenceStreak: 1 }))).toBeNull()
  })
  it('forces handoff after six turns without progress', () => {
    expect(forcedHandoffReason(facts({ turnsWithoutProgress: 5 }))).toBeNull()
    expect(forcedHandoffReason(facts({ turnsWithoutProgress: 6 }))).toBe('tanpa_kemajuan')
  })
  it('forces handoff for valuable requests outside the catalog', () => {
    for (const m of ['bisa buatkan penawaran?', 'kirim proposal dong', 'mau kerja sama', 'ada diskon khusus?'])
      expect(forcedHandoffReason(facts({ message: m })), m).toBe('luar_katalog_bernilai')
  })
  it('does not force handoff for a normal question', () => {
    expect(forcedHandoffReason(facts())).toBeNull()
  })
})

describe('evaluateRules', () => {
  it('a forced handoff beats any rule', () => {
    const p = withRules([r('r1', { intents: ['komplain'] }, 'reply_only')])
    expect(evaluateRules(p, facts({ intent: 'komplain' }))).toMatchObject({ kind: 'handoff', forced: true, reason: 'komplain' })
  })
  it('the first matching rule wins and swapping the order changes the result', () => {
    const a = r('a', { intents: ['tanya_harga'] }, 'reply_only')
    const b = r('b', { intents: ['tanya_harga'] }, 'send_checkout')
    expect(evaluateRules(withRules([a, b]), facts({ intent: 'tanya_harga' }))).toMatchObject({ kind: 'reply_only', ruleId: 'a', forced: false })
    expect(evaluateRules(withRules([b, a]), facts({ intent: 'tanya_harga' }))).toMatchObject({ kind: 'send_checkout', ruleId: 'b' })
  })
  it('skips disabled rules', () => {
    const p = withRules([r('a', {}, 'silent', { enabled: false }), r('b', {}, 'reply_only')])
    expect(evaluateRules(p, facts()).ruleId).toBe('b')
  })
  it('honours maxPerContact', () => {
    const p = withRules([r('a', {}, 'send_link', { maxPerContact: 1 }), r('b', {}, 'reply_only')])
    expect(evaluateRules(p, facts({ ruleCounts: {} })).ruleId).toBe('a')
    expect(evaluateRules(p, facts({ ruleCounts: { a: 1 } })).ruleId).toBe('b')
  })
  it('matches keywords case-insensitively and combines conditions with AND', () => {
    const p = withRules([r('a', { keywords: ['Promo'], intents: ['tanya_produk'] }, 'send_link')])
    expect(evaluateRules(p, facts({ message: 'ada PROMO?' })).ruleId).toBe('a')
    expect(evaluateRules(p, facts({ message: 'ada PROMO?', intent: 'tanya_harga' })).ruleId).toBeNull()
  })
  it('withinHours:false only matches outside working hours', () => {
    const p = withRules([r('a', { withinHours: false }, 'reply_only', { })])
    expect(evaluateRules(p, facts({ withinHours: true })).ruleId).toBeNull()
    expect(evaluateRules(p, facts({ withinHours: false })).ruleId).toBe('a')
  })
  it('supports product, minTurns and leadComplete conditions', () => {
    const p = withRules([r('a', { productId: 'p1', minTurns: 3, leadComplete: true }, 'handoff')])
    expect(evaluateRules(p, facts({ productId: 'p1', turns: 3, leadComplete: true })).ruleId).toBe('a')
    expect(evaluateRules(p, facts({ productId: 'p1', turns: 2, leadComplete: true })).ruleId).toBeNull()
    expect(evaluateRules(p, facts({ productId: 'p2', turns: 3, leadComplete: true })).ruleId).toBeNull()
  })
  it('passes rule parameters through to the chosen action', () => {
    const p = withRules([{ id: 'a', enabled: true, when: {}, then: { action: 'send_link', linkId: 'l1', message: 'Ini ya' } }])
    expect(evaluateRules(p, facts())).toMatchObject({ kind: 'send_link', linkId: 'l1', message: 'Ini ya' })
  })
  it('falls back to the model suggestion only when it fits the profile goal', () => {
    const none = withRules([])
    expect(evaluateRules({ ...none, goal: 'checkout' }, facts({ suggested: 'send_checkout' })).kind).toBe('send_checkout')
    expect(evaluateRules({ ...none, goal: 'checkout' }, facts({ suggested: 'send_checkout', checkoutAvailable: false })).kind).toBe('reply_only')
    expect(evaluateRules({ ...none, goal: 'lead' }, facts({ suggested: 'send_checkout' })).kind).toBe('reply_only')
    expect(evaluateRules({ ...none, goal: 'handoff' }, facts({ suggested: 'handoff' })).kind).toBe('handoff')
    expect(evaluateRules({ ...none, goal: 'lead' }, facts({ suggested: 'handoff' })).kind).toBe('reply_only')
  })
  it('replies only when nothing matches and nothing is suggested', () => {
    expect(evaluateRules(withRules([]), facts())).toMatchObject({ kind: 'reply_only', ruleId: null, forced: false })
  })
})

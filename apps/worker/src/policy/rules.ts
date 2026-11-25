import type { ActionKind, BrandProfile, Intent, Rule } from '@autobot/contracts/brand'

export interface RuleFacts {
  intent: Intent
  suggested: 'none' | 'send_checkout' | 'handoff' | 'ask_more'
  message: string
  productId: string | null
  withinHours: boolean
  /** Number of customer turns so far in this conversation. */
  turns: number
  leadComplete: boolean
  confidence: number
  /** Consecutive low-confidence turns BEFORE this one. */
  lowConfidenceStreak: number
  turnsWithoutProgress: number
  ruleCounts: Record<string, number>
  /** A checkout link or product with a checkout url exists. */
  checkoutAvailable: boolean
}

export type ChosenAction = {
  kind: ActionKind
  linkId?: string
  productId?: string
  adminId?: string
  message?: string
  ruleId: string | null
  forced: boolean
  reason?: string
}

export const LOW_CONFIDENCE = 0.5
export const STALL_TURNS = 6

const SENSITIVE = /\b(refund|tagihan|chargeback|ganti rugi|komplain|penipuan)\b/i
const VALUABLE = /\b(penawaran|proposal|kerja ?sama|diskon khusus)\b/i

/** Situations where a human must take over, whatever the rules or the model say. */
export function forcedHandoffReason(f: RuleFacts): string | null {
  if (f.intent === 'minta_manusia') return 'minta_manusia'
  if (f.intent === 'komplain') return 'komplain'
  if (SENSITIVE.test(f.message)) return 'kata_kunci_sensitif'
  if (f.confidence < LOW_CONFIDENCE && f.lowConfidenceStreak + 1 >= 2) return 'keyakinan_rendah'
  if (f.turnsWithoutProgress >= STALL_TURNS) return 'tanpa_kemajuan'
  if (VALUABLE.test(f.message)) return 'luar_katalog_bernilai'
  return null
}

function matches(r: Rule, f: RuleFacts): boolean {
  const w = r.when
  if (w.intents && !w.intents.includes(f.intent)) return false
  if (w.keywords && !w.keywords.some((k) => f.message.toLowerCase().includes(k.toLowerCase()))) return false
  if (w.productId !== undefined && w.productId !== f.productId) return false
  if (w.withinHours !== undefined && w.withinHours !== f.withinHours) return false
  if (w.minTurns !== undefined && f.turns < w.minTurns) return false
  if (w.leadComplete !== undefined && w.leadComplete !== f.leadComplete) return false
  return true
}

/** Model output only suggests; this decides. Order: forced handoff, user rules top-down, goal-based fallback. */
export function evaluateRules(profile: BrandProfile, f: RuleFacts): ChosenAction {
  const forced = forcedHandoffReason(f)
  if (forced) return { kind: 'handoff', ruleId: null, forced: true, reason: forced }

  for (const r of profile.rules) {
    if (!r.enabled) continue
    if (r.maxPerContact !== undefined && (f.ruleCounts[r.id] ?? 0) >= r.maxPerContact) continue
    if (!matches(r, f)) continue
    return {
      kind: r.then.action,
      linkId: r.then.linkId,
      productId: r.then.productId,
      adminId: r.then.adminId,
      message: r.then.message,
      ruleId: r.id,
      forced: false
    }
  }

  if (f.suggested === 'send_checkout' && profile.goal === 'checkout' && f.checkoutAvailable)
    return { kind: 'send_checkout', ruleId: null, forced: false }
  if (f.suggested === 'handoff' && profile.goal === 'handoff')
    return { kind: 'handoff', ruleId: null, forced: false, reason: 'saran_model' }
  return { kind: 'reply_only', ruleId: null, forced: false }
}

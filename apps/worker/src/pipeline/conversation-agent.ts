import { createHash } from 'node:crypto'
import type { BrandProfile, Intent } from '@autobot/contracts/brand'
import type { Hit } from '@autobot/contracts/types'
import type { IndexStore } from '../knowledge/index-store'
import { buildLinkAllowlist, type CatalogStore, type Product } from '../catalog/catalog-store'
import type { ConversationStore, ContactState } from '../conversation/store'
import {
  farewellText, fillTemplate, formatHoursText, greetingWord, isWithinHours, type HandoffService
} from '../conversation/handoff'
import type { WaGateway } from '../wa/gateway'
import { AiError, type AiProvider } from '../answer/ai-answerer'
import { runAgent, type AgentContext } from '../answer/agent'
import { MEMORY, applyFactUpdates, foldSummary, planFold } from '../conversation/memory'
import { evaluateRules, LOW_CONFIDENCE, type ChosenAction, type RuleFacts } from '../policy/rules'
import { removeCtaSentences, removeSelfNumber, sanitizeChunk, stripDisallowedUrls, unknownNumbers } from '../policy/guards'

export interface AgentTurnInput {
  chatId: string
  text: string
  profile: BrandProfile
  provider: AiProvider
  cfg: { model: string; maxTokens: number }
  /** No side effects at all: nothing stored, no handoff, no events (used by the preview panel). */
  dryRun: boolean
  timeoutMs?: number
  /** Read and write what is remembered about this customer. Default true. */
  memory?: boolean
}

export interface AgentTurnResult {
  intent: Intent
  action: ChosenAction
  replyParts: string[]
  linkSent: string | null
  handoff: { reason: string } | null
  sources: string[]
  matchedRule: string | null
  removed: { numbers: boolean; urls: string[]; numbersUnknown: string[]; cta: boolean }
  fallback: boolean
  /** How many times the AI was tried before giving up; set only when `fallback` is true. */
  attempts?: number
  /** Why the AI's answer was not used; set only when `fallback` is true. */
  fallbackReason?: 'timeout' | 'auth' | 'rate_limit' | 'network' | 'unusable'
  hits: Hit[]
}

const HISTORY_TURNS = 10
const DAY_MS = 24 * 3_600_000
/** Below this share of the message's words found in the best document, the conversation is searched too. */
const WEAK_COVERAGE = 0.5
const FACTUAL: Intent[] = ['tanya_harga', 'tanya_produk', 'siap_beli', 'keberatan']

const rupiah = (n: number): string => 'Rp' + n.toLocaleString('id-ID')

function trackedUrl(url: string, chatId: string): string {
  try {
    const u = new URL(url)
    u.searchParams.set('utm_source', 'wa_bot')
    u.searchParams.set('utm_medium', 'whatsapp')
    u.searchParams.set('ref', createHash('sha1').update(chatId).digest('hex').slice(0, 8))
    return u.toString()
  } catch {
    return url
  }
}

function cleanLead(updates: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(updates)) {
    const key = k.trim().slice(0, 40)
    const val = v.trim().slice(0, 200)
    if (key && val) out[key] = val
  }
  return out
}

export class ConversationAgent {
  /** Chats whose summary is being written right now: one at a time per chat. */
  private folding = new Set<string>()

  constructor(
    private d: {
      store: IndexStore
      catalog: CatalogStore
      conv: ConversationStore
      handoff: HandoffService
      gateway: WaGateway
      clock: { now(): number }
      /** Waits between attempts when the AI fails; one more attempt follows each wait. Default: 2 s, then 5 s (3 tries). */
      retryDelaysMs?: number[]
    }
  ) {}

  /**
   * Folds old turns into the customer's summary when there are too many or a long silence has passed. Runs after the
   * reply has gone out. Never throws; on any failure nothing changes and a later call tries again.
   */
  async maybeFold(i: { chatId: string; provider: AiProvider; cfg: { model: string } }): Promise<boolean> {
    const { chatId } = i
    if (this.folding.has(chatId)) return false
    this.folding.add(chatId)
    try {
      const { conv } = this.d
      const turns = conv.unsummarizedTurns(chatId)
      const plan = planFold(turns)
      if (!plan) return false
      const memory = conv.getMemory(chatId)
      const text = await foldSummary(i.provider, i.cfg, {
        prev: memory.summary, facts: memory.facts, turns: turns.filter((t) => t.id <= plan.upToId)
      })
      if (!text) return false
      conv.setSummary(chatId, text, plan.upToId)
      return true
    } catch {
      return false
    } finally {
      this.folding.delete(chatId)
    }
  }

  async handleTurn(i: AgentTurnInput): Promise<AgentTurnResult> {
    const { profile, chatId, text, dryRun } = i
    const { conv, catalog } = this.d
    const now = this.d.clock.now()
    const botNumber = this.d.gateway.selfNumber()
    const state = conv.getState(chatId)
    const useMemory = i.memory !== false
    // With memory on, only turns not yet folded into the summary are shown, each trimmed so the prompt stays small.
    const history = useMemory
      ? conv.unsummarizedTurns(chatId, MEMORY.stmTurns).map((t) => ({ role: t.role, text: t.text.slice(0, MEMORY.stmChars) }))
      : conv.recentTurns(chatId, HISTORY_TURNS)
    const memory = useMemory ? conv.getMemory(chatId) : null

    const hits = this.retrieve(text, history)
      .map((h) => ({ ...h, text: sanitizeChunk(h.text, botNumber) }))
      .filter((h) => h.text.trim() !== '')
    const allProducts = catalog.list()
    const matched = new Map<string, Product>()
    for (const p of catalog.find(text, 3)) matched.set(p.id, p)
    const current = state.productId ? catalog.byId(state.productId) : null
    if (current) matched.set(current.id, current)
    const products = [...matched.values()]
    const withinHours = isWithinHours(profile, now)
    const allowlist = buildLinkAllowlist(profile, allProducts)

    const ctx: AgentContext = {
      profile, message: text, hits, products, lead: state.lead, stage: state.stage, history, withinHours, botNumber,
      ...(memory && (memory.summary || Object.keys(memory.facts).length) ? { memory: { summary: memory.summary, facts: memory.facts } } : {})
    }

    // A failed or unusable answer is retried with a pause in between. A rejected key will not fix itself, so it is not.
    const delays = this.d.retryDelaysMs ?? [2_000, 5_000]
    let out: Awaited<ReturnType<typeof runAgent>> = null
    let failure: NonNullable<AgentTurnResult['fallbackReason']> = 'unusable'
    let attempts = 0
    for (;;) {
      attempts++
      try {
        out = await runAgent(i.provider, ctx, i.cfg, i.timeoutMs)
        failure = 'unusable'
      } catch (e) {
        if (!(e instanceof AiError)) throw e
        failure = e.code === 'RATE_LIMIT' ? 'rate_limit' : (e.code.toLowerCase() as 'timeout' | 'auth' | 'network')
        out = null
      }
      if (out || failure === 'auth' || attempts > delays.length) break
      await new Promise<void>((r) => setTimeout(r, delays[attempts - 1]))
    }
    if (!out) return this.fallback(i, state, hits, now, failure, attempts)

    const updates = cleanLead(out.lead_updates)
    const lead = { ...state.lead, ...updates }
    const leadChanged = Object.keys(updates).some((k) => lead[k] !== state.lead[k])
    const productId = out.product_id && catalog.byId(out.product_id) ? out.product_id : state.productId
    const product = productId ? catalog.byId(productId) : null
    const vars = this.vars(profile, lead, product)
    const unknownText = fillTemplate(profile.templates.unknown, vars)

    // 1. Clean what the model wrote.
    let removedNumbers = false
    let removedCta = false
    const removedUrls: string[] = []
    let parts: string[] = []
    for (let p of out.reply_parts) {
      if (botNumber) {
        const r = removeSelfNumber(p, botNumber)
        if (r.removed) removedNumbers = true
        p = r.text
      }
      const c = removeCtaSentences(p)
      if (c.removed) removedCta = true
      p = c.text
      const u = stripDisallowedUrls(p, allowlist)
      removedUrls.push(...u.removed)
      if (u.text.trim()) parts.push(u.text.trim())
    }

    let forcedReason: string | null = null
    let numbersUnknown: string[] = []
    if (out.intent === 'di_luar_konteks') {
      parts = [unknownText] // never trust free text for something the documents do not cover
    } else if (FACTUAL.includes(out.intent) && hits.length === 0 && matched.size === 0) {
      parts = [unknownText]
    } else {
      const known = [
        ...hits.map((h) => h.text),
        ...allProducts.map((p) => `${p.name} ${p.price ?? ''} ${p.description}`),
        text,
        ...history.map((t) => t.text),
        ...(memory ? [memory.summary, ...Object.values(memory.facts)] : []),
        ...Object.values(lead),
        ...profile.objections.map((o) => o.answer),
        profile.identity.about
      ].join('\n')
      numbersUnknown = unknownNumbers(parts.join('\n'), known)
      if (numbersUnknown.length) {
        parts = [unknownText]
        if (profile.businessType === 'jasa') forcedReason = 'angka_tak_dikenal'
      }
    }
    if (parts.length === 0) parts = [unknownText]

    // 2. Decide the action (rules, not the model).
    const facts: RuleFacts = {
      intent: out.intent,
      suggested: out.suggested_action,
      message: text,
      productId,
      withinHours,
      turns: history.filter((t) => t.role === 'user').length + 1,
      leadComplete: profile.leadMinimum.every((k) => !!lead[k]),
      confidence: out.confidence,
      lowConfidenceStreak: state.lowConfidenceStreak,
      turnsWithoutProgress: state.turnsWithoutProgress,
      ruleCounts: state.ruleCounts,
      checkoutAvailable:
        profile.links.some((l) => l.kind === 'checkout') || allProducts.some((p) => p.checkoutUrl !== null)
    }
    const evaluated = evaluateRules(profile, facts)
    // A stronger forced reason (complaint, human requested, ...) keeps its own label.
    const action: ChosenAction =
      forcedReason && !evaluated.forced
        ? { kind: 'handoff', ruleId: null, forced: true, reason: forcedReason }
        : evaluated

    // 3. Remember the turn before acting, so a handoff summary already contains this message.
    if (!dryRun) {
      conv.appendTurn(chatId, 'user', text)
      if (leadChanged) {
        conv.mergeLead(chatId, updates)
        conv.recordEvent(chatId, 'lead_updated')
      }
      if (memory) {
        const facts = applyFactUpdates(memory.facts, out.memory_updates)
        if (JSON.stringify(facts) !== JSON.stringify(memory.facts)) conv.setFacts(chatId, facts)
      }
      const progressed = out.stage !== state.stage || leadChanged || (!!productId && productId !== state.productId)
      conv.patchState(chatId, {
        stage: out.stage,
        productId,
        lowConfidenceStreak: out.confidence < LOW_CONFIDENCE ? state.lowConfidenceStreak + 1 : 0,
        turnsWithoutProgress: progressed ? 0 : state.turnsWithoutProgress + 1,
        ruleCounts: action.ruleId
          ? { ...state.ruleCounts, [action.ruleId]: (state.ruleCounts[action.ruleId] ?? 0) + 1 }
          : state.ruleCounts
      })
    }

    // 4. Carry the action out.
    let finalParts = parts
    let linkSent: string | null = null
    let handoffReason: string | null = null
    let finalAction = action

    const doHandoff = async (reason: string, adminId?: string) => {
      handoffReason = reason
      finalAction = { ...action, kind: 'handoff', reason, adminId }
      const farewell = dryRun
        ? farewellText(profile, now, product?.name ?? null, lead)
        : (await this.d.handoff.trigger({ profile, chatId, reason, adminId, productName: product?.name ?? null })).farewell
      finalParts = [farewell]
    }

    switch (action.kind) {
      case 'handoff':
        await doHandoff(action.reason ?? 'aturan', action.adminId)
        break
      case 'send_checkout': {
        const pid = action.productId ?? productId ?? undefined
        const prod = pid ? catalog.byId(pid) : null
        let url: string | null = null
        let tracking = true
        const byId = action.linkId ? profile.links.find((l) => l.id === action.linkId) : undefined
        const byKind = profile.links.find((l) => l.kind === 'checkout' && (!l.productId || l.productId === pid))
        const link = byId ?? (prod?.checkoutUrl ? undefined : byKind)
        if (link) { url = link.url; tracking = link.tracking } else if (prod?.checkoutUrl) url = prod.checkoutUrl
        if (!url) {
          await doHandoff('tanpa_tautan', action.adminId)
          break
        }
        const last = conv.lastEventAt(chatId, 'checkout_sent', pid)
        if (last !== null && now - last < DAY_MS) break // already sent recently: keep the model text only
        linkSent = tracking ? trackedUrl(url, chatId) : url
        const msg = fillTemplate(action.message ?? profile.templates.checkout, {
          ...this.vars(profile, lead, prod ?? product), tautan: linkSent
        })
        finalParts = [...parts.slice(0, 2), msg]
        if (!dryRun) conv.recordEvent(chatId, 'checkout_sent', pid)
        break
      }
      case 'send_link': {
        const link = profile.links.find((l) => l.id === action.linkId)
        if (!link) break
        const last = conv.lastEventAt(chatId, 'link_sent', link.id)
        if (last !== null && now - last < DAY_MS) break
        linkSent = link.tracking ? trackedUrl(link.url, chatId) : link.url
        const msg = fillTemplate(action.message ?? '{tautan}', { ...this.vars(profile, lead, product), produk: link.name, tautan: linkSent })
        finalParts = [...parts.slice(0, 2), msg]
        if (!dryRun) conv.recordEvent(chatId, 'link_sent', link.id)
        break
      }
      case 'ask_lead': {
        const next = [...profile.leadQuestions].sort((a, b) => a.order - b.order).find((q) => !lead[q.key])
        if (next) finalParts = [...parts.slice(0, 1), fillTemplate(next.text, vars)]
        break
      }
      case 'silent':
        finalParts = []
        break
      case 'reply_only':
        if (action.message) finalParts = [...parts.slice(0, 2), fillTemplate(action.message, vars)]
        break
    }

    if (!dryRun && finalParts.length > 0) conv.appendTurn(chatId, 'bot', finalParts.join('\n'))

    return {
      intent: out.intent,
      action: finalAction,
      replyParts: finalParts,
      linkSent,
      handoff: handoffReason ? { reason: handoffReason } : null,
      sources: out.sources,
      matchedRule: action.ruleId,
      removed: { numbers: removedNumbers, urls: removedUrls, numbersUnknown, cta: removedCta },
      fallback: false,
      hits
    }
  }

  /**
   * Documents for this message. Short answers ("Loundry") and follow-ups ("yang itu berapa?") carry little
   * topic of their own, so when the message alone finds weak matches the previous customer message and the
   * bot's last question join the search. The message's own hits always come first.
   */
  private retrieve(text: string, history: { role: string; text: string }[]): Hit[] {
    const own = this.d.store.search(text, 5)
    if (own.length > 0 && own[0].coverage >= WEAK_COVERAGE) return own
    const lastOf = (role: string) => [...history].reverse().find((t) => t.role === role)?.text
    const context = [lastOf('user'), lastOf('bot')].filter((x): x is string => !!x)
    if (context.length === 0) return own
    const seen = new Set(own.map((h) => h.chunkId))
    const extra = this.d.store.search([...context, text].join(' '), 5).filter((h) => !seen.has(h.chunkId))
    return [...own, ...extra].slice(0, 5)
  }

  /** The AI failed on every attempt: the conversation goes to a person. */
  private async fallback(
    i: AgentTurnInput, state: ContactState, hits: Hit[], now: number, reason: NonNullable<AgentTurnResult['fallbackReason']>,
    attempts: number
  ): Promise<AgentTurnResult> {
    const { profile, chatId, text, dryRun } = i
    const { conv } = this.d
    if (!dryRun) {
      conv.appendTurn(chatId, 'user', text)
      conv.patchState(chatId, { lowConfidenceStreak: state.lowConfidenceStreak + 1 })
    }
    const handoff = { reason: 'ai_gagal' }
    const action: ChosenAction = { kind: 'handoff', ruleId: null, forced: true, reason: 'ai_gagal' }
    const farewell = dryRun
      ? farewellText(profile, now, null, state.lead)
      : (await this.d.handoff.trigger({ profile, chatId, reason: 'ai_gagal', productName: null })).farewell
    const replyParts = [farewell]
    if (!dryRun) conv.appendTurn(chatId, 'bot', replyParts.join('\n'))
    return {
      intent: 'di_luar_konteks', action, replyParts, linkSent: null, handoff, sources: [], matchedRule: null,
      removed: { numbers: false, urls: [], numbersUnknown: [], cta: false }, fallback: true, attempts, fallbackReason: reason, hits
    }
  }

  private vars(profile: BrandProfile, lead: Record<string, string>, product: Product | null): Record<string, string> {
    return {
      sapaan: greetingWord(profile),
      nama: lead.nama ?? '',
      produk: product?.name ?? '',
      harga: product?.price != null ? rupiah(product.price) : '',
      tautan: '',
      jam_kerja: formatHoursText(profile)
    }
  }
}

import { z } from 'zod'

export const INTENTS = [
  'tanya_harga', 'tanya_produk', 'siap_beli', 'keberatan', 'minta_manusia',
  'komplain', 'sapaan', 'terima_kasih', 'di_luar_konteks', 'spam'
] as const
export type Intent = (typeof INTENTS)[number]

export const ACTION_KINDS = ['send_checkout', 'send_link', 'handoff', 'ask_lead', 'reply_only', 'silent'] as const
export type ActionKind = (typeof ACTION_KINDS)[number]

export const STAGES = ['sapa', 'gali', 'rekomendasi', 'harga', 'keberatan', 'cta'] as const
export type Stage = (typeof STAGES)[number]

const time = z.string().regex(/^\d{2}:\d{2}$/)
const text = (max: number) => z.string().max(max)

const RuleSchema = z
  .object({
    id: z.string().min(1).max(40),
    enabled: z.boolean(),
    when: z
      .object({
        intents: z.array(z.enum(INTENTS)).optional(),
        keywords: z.array(text(60)).max(30).optional(),
        productId: text(60).optional(),
        withinHours: z.boolean().optional(),
        minTurns: z.number().int().min(0).max(100).optional(),
        leadComplete: z.boolean().optional()
      })
      .strict(),
    then: z
      .object({
        action: z.enum(ACTION_KINDS),
        linkId: text(40).optional(),
        productId: text(60).optional(),
        adminId: text(40).optional(),
        message: text(800).optional()
      })
      .strict(),
    maxPerContact: z.number().int().min(1).max(100).optional()
  })
  .strict()

const LinkSchema = z
  .object({
    id: z.string().min(1).max(40),
    name: text(80),
    kind: z.enum(['checkout', 'booking', 'catalog', 'form', 'site']),
    url: text(500),
    tracking: z.boolean(),
    productId: text(60).optional()
  })
  .strict()

const AdminSchema = z
  .object({ id: z.string().min(1).max(40), name: text(80), number: text(30), notifyWhatsapp: z.boolean() })
  .strict()

const LeadQuestionSchema = z
  .object({
    key: z.string().min(1).max(40),
    text: text(300),
    required: z.boolean(),
    order: z.number().int().min(0).max(100),
    skipWords: z.array(text(40)).max(10)
  })
  .strict()

const DaySchema = z.object({ open: time, close: time }).strict().nullable()

export const BrandProfileSchema = z
  .object({
    version: z.number().int().min(0),
    businessType: z.enum(['produk', 'jasa']),
    preset: text(40),
    identity: z
      .object({
        businessName: text(80),
        botName: text(40),
        about: text(500),
        language: z.enum(['id', 'en', 'auto'])
      })
      .strict(),
    style: z
      .object({
        tone: z.enum(['formal', 'ramah', 'santai', 'antusias']),
        greeting: z.enum(['kak', 'bapak_ibu', 'anda', 'ikuti']),
        emoji: z.union([z.literal(0), z.literal(1), z.literal(2)]),
        length: z.enum(['ringkas', 'sedang', 'rinci']),
        mustWords: z.array(text(60)).max(30),
        bannedWords: z.array(text(60)).max(50),
        introduceAsBot: z.boolean(),
        introText: text(300),
        examples: z.array(z.object({ q: text(300), a: text(600) }).strict()).max(10)
      })
      .strict(),
    goal: z.enum(['checkout', 'handoff', 'lead', 'booking', 'form']),
    rules: z.array(RuleSchema).max(50),
    links: z.array(LinkSchema).max(50),
    admins: z.array(AdminSchema).max(10),
    leadQuestions: z.array(LeadQuestionSchema).max(10),
    leadMinimum: z.array(z.string().max(40)).max(10),
    objections: z.array(z.object({ trigger: text(80), answer: text(600) }).strict()).max(20),
    templates: z
      .object({
        handoffFarewell: text(600),
        checkout: text(600),
        outsideHours: text(600),
        unknown: text(600)
      })
      .strict(),
    hours: z
      .object({
        timezone: text(60),
        days: z
          .object({
            '0': DaySchema, '1': DaySchema, '2': DaySchema, '3': DaySchema,
            '4': DaySchema, '5': DaySchema, '6': DaySchema
          })
          .strict()
      })
      .strict(),
    limits: z
      .object({
        pauseHours: z.number().min(0).max(168),
        maxRepliesPerHour: z.number().int().min(1).max(1000),
        dailyTokenBudget: z.number().int().min(0).max(10_000_000)
      })
      .strict(),
    bannedTopics: z.array(text(80)).max(30)
  })
  .strict()

export type BrandProfile = z.infer<typeof BrandProfileSchema>
export type Rule = z.infer<typeof RuleSchema>
export type LinkEntry = z.infer<typeof LinkSchema>
export type AdminEntry = z.infer<typeof AdminSchema>
export type LeadQuestion = z.infer<typeof LeadQuestionSchema>

export type Issue = { level: 'error' | 'warn'; field: string; message: string }
export interface ValidateCtx {
  botNumber: string | null
  productCount: number
}

/** Digits only; a leading 0 becomes the Indonesian country code 62. */
export function normalizeNumber(n: string): string {
  const d = n.replace(/\D/g, '')
  return d.startsWith('0') ? '62' + d.slice(1) : d
}

export function validateProfile(p: BrandProfile, ctx: ValidateCtx): Issue[] {
  const out: Issue[] = []
  const err = (field: string, message: string) => out.push({ level: 'error', field, message })
  const warn = (field: string, message: string) => out.push({ level: 'warn', field, message })
  const bot = ctx.botNumber ? normalizeNumber(ctx.botNumber) : null

  if (!p.identity.businessName.trim()) warn('identity.businessName', 'Nama bisnis belum diisi.')

  if (p.admins.length === 0)
    warn('admins', 'Belum ada admin: saat percakapan diserahkan, tidak ada manusia yang dikabari lewat WhatsApp (hanya notifikasi di komputer ini).')

  p.admins.forEach((a, i) => {
    const n = normalizeNumber(a.number)
    if (n.length < 8) err(`admins[${i}].number`, 'Nomor admin tidak valid.')
    else if (bot && n === bot) err(`admins[${i}].number`, 'Nomor admin tidak boleh sama dengan nomor bot.')
  })

  p.links.forEach((l, i) => {
    if (!/^https:\/\/[^\s/]+/i.test(l.url)) err(`links[${i}].url`, 'URL harus diawali https://')
  })

  if (p.goal === 'checkout' && ctx.productCount === 0 && !p.links.some((l) => l.kind === 'checkout'))
    err('goal', 'Tujuan Checkout butuh minimal satu tautan checkout atau produk di katalog.')

  const linkIds = new Set(p.links.map((l) => l.id))
  const adminIds = new Set(p.admins.map((a) => a.id))
  p.rules.forEach((r, i) => {
    if (r.then.linkId && !linkIds.has(r.then.linkId)) err(`rules[${i}].then.linkId`, 'Tautan tidak ditemukan.')
    if (r.then.adminId && !adminIds.has(r.then.adminId)) err(`rules[${i}].then.adminId`, 'Admin tidak ditemukan.')
  })

  const allClosed = Object.values(p.hours.days).every((d) => d === null)
  if (allClosed && p.rules.some((r) => r.enabled && r.when.withinHours !== undefined))
    warn('hours', 'Ada aturan yang memakai jam kerja, tetapi semua hari tutup.')

  return out
}

const DEFAULT_DAYS: BrandProfile['hours']['days'] = {
  '0': null,
  '1': { open: '09:00', close: '17:00' },
  '2': { open: '09:00', close: '17:00' },
  '3': { open: '09:00', close: '17:00' },
  '4': { open: '09:00', close: '17:00' },
  '5': { open: '09:00', close: '17:00' },
  '6': null
}

const BASE: BrandProfile = {
  version: 0,
  businessType: 'jasa',
  preset: 'kustom',
  identity: { businessName: '', botName: 'Asisten', about: '', language: 'id' },
  style: {
    tone: 'ramah', greeting: 'kak', emoji: 1, length: 'ringkas', mustWords: [], bannedWords: [],
    introduceAsBot: true, introText: 'Halo, saya asisten otomatis. Ada yang bisa saya bantu?', examples: []
  },
  goal: 'lead',
  rules: [],
  links: [],
  admins: [],
  leadQuestions: [
    { key: 'nama', text: 'Boleh tahu nama Kakak?', required: true, order: 0, skipWords: [] },
    { key: 'kebutuhan', text: 'Kakak butuh apa dan untuk usaha apa?', required: true, order: 1, skipWords: [] },
    { key: 'anggaran', text: 'Kira-kira anggaran yang disiapkan berapa?', required: false, order: 2, skipWords: ['skip', 'lewati'] },
    { key: 'waktu', text: 'Targetnya mulai kapan?', required: false, order: 3, skipWords: ['skip', 'lewati'] }
  ],
  leadMinimum: ['nama', 'kebutuhan'],
  objections: [],
  templates: {
    handoffFarewell: 'Baik {sapaan}, saya teruskan ke tim kami ya. Tim kami biasanya membalas {jam_kerja}.',
    checkout: 'Ini tautan untuk memesan {produk}: {tautan}',
    outsideHours:
      'Saat ini di luar jam kerja tim kami ({jam_kerja}). Pesan {sapaan} sudah kami catat dan akan dibalas saat jam kerja.',
    unknown: 'Untuk hal itu saya kurang tahu, {sapaan}. Boleh saya bantu seputar produk atau layanan kami?'
  },
  hours: { timezone: 'Asia/Makassar', days: DEFAULT_DAYS },
  limits: { pauseHours: 6, maxRepliesPerHour: 30, dailyTokenBudget: 0 },
  bannedTopics: []
}

function preset(id: string, over: Partial<BrandProfile>): BrandProfile {
  return { ...structuredClone(BASE), preset: id, ...structuredClone(over) }
}

const rule = (id: string, when: Rule['when'], then: Rule['then'], extra: Partial<Rule> = {}): Rule => ({
  id, enabled: true, when, then, ...extra
})

const SERVICE_RULES: Rule[] = [
  rule('r1', { intents: ['komplain'] }, { action: 'handoff' }),
  rule('r2', { intents: ['minta_manusia'] }, { action: 'handoff' }),
  rule('r3', { keywords: ['refund', 'tagihan'] }, { action: 'handoff' }),
  rule('r4', { intents: ['siap_beli'], leadComplete: true }, { action: 'handoff' }),
  rule('r5', { intents: ['siap_beli'], leadComplete: false }, { action: 'ask_lead' }),
  rule('r6', { withinHours: false }, { action: 'reply_only' })
]

const PRODUCT_RULES: Rule[] = [
  rule('r1', { intents: ['komplain'] }, { action: 'handoff' }),
  rule('r2', { intents: ['minta_manusia'] }, { action: 'handoff' }),
  rule('r3', { intents: ['siap_beli'] }, { action: 'send_checkout' }),
  rule('r4', { intents: ['tanya_harga'] }, { action: 'reply_only' })
]

export const PRESETS = {
  toko_online: preset('toko_online', { businessType: 'produk', goal: 'checkout', rules: PRODUCT_RULES }),
  jasa_agensi: preset('jasa_agensi', { businessType: 'jasa', goal: 'handoff', rules: SERVICE_RULES }),
  kuliner: preset('kuliner', { businessType: 'produk', goal: 'checkout', rules: PRODUCT_RULES }),
  klinik_salon: preset('klinik_salon', { businessType: 'jasa', goal: 'booking', rules: SERVICE_RULES }),
  pendidikan: preset('pendidikan', { businessType: 'jasa', goal: 'lead', rules: SERVICE_RULES }),
  properti: preset('properti', { businessType: 'jasa', goal: 'lead', rules: SERVICE_RULES }),
  kustom: preset('kustom', {})
} satisfies Record<string, BrandProfile>

export type PresetId = keyof typeof PRESETS

import { z } from 'zod'

export type Tier = 'baru' | 'berkembang' | 'mapan'
export type ContactStatus = 'aktif' | 'menunggu_persetujuan' | 'tidak_aktif'
export type SuppressReason = 'berhenti' | 'laporan' | 'tidak_terdaftar' | 'blokir_manual' | 'admin' | 'tolak_lunak'
export type CampaignKind = 'broadcast' | 'konfirmasi'
export type CampaignStatus = 'draf' | 'terjadwal' | 'berjalan' | 'dijeda' | 'dihentikan' | 'selesai'
export type SendStatus = 'antre' | 'terkirim' | 'gagal' | 'dilewati'
export type Audience = 'chat' | 'impor' | 'semua'

export interface BContact {
  id: number
  number: string | null
  jid: string | null
  name: string
  vars: Record<string, string>
  source: 'chat' | 'impor'
  status: ContactStatus
  lastInboundAt: number | null
  lastSentAt: number | null
  sentCount: number
  importId: number | null
}

export interface Campaign {
  id: number
  name: string
  kind: CampaignKind
  template: string
  status: CampaignStatus
  pauseReason: string | null
  createdAt: number
  startedAt: number | null
  audience: Audience
  /** Recipients picked by hand; null means everyone in the audience. */
  contactIds: number[] | null
  notBefore: number | null
}

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)

export const IdSchema = z.number().int().positive()
export const AttestSchema = z
  .object({ accepted: z.literal(true), sourceNote: z.string().trim().min(10).max(300) })
  .strict()
export const CampaignInputSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    template: z.string().min(1).max(1000),
    audience: z.enum(['chat', 'impor', 'semua']),
    contactIds: z.array(z.number().int().positive()).min(1).max(50_000).nullable().optional()
  })
  .strict()
export const AudienceSchema = z.enum(['chat', 'impor', 'semua'])
export const AddContactSchema = z
  .object({
    name: z.string().trim().max(100),
    number: z.string().trim().min(1).max(30),
    accepted: z.literal(true),
    sourceNote: z.string().trim().min(10).max(300)
  })
  .strict()
export const ImportFileSchema = z
  .object({ name: z.string().max(200), data: z.union([z.string().max(15_000_000), z.instanceof(Uint8Array)]) })
  .strict()
export const SafetyPatchSchema = z
  .object({
    enabled: z.boolean(),
    ageDays: z.number().int().min(0).max(3650),
    minGapDays: z.number().int().min(3).max(7),
    window: z.object({ start: HHMM, end: HHMM, timezone: z.string().max(60) }).strict(),
    changeNumber: z.boolean(),
    confirm: z.boolean()
  })
  .partial()
  .strict()
export const ConfirmTextSchema = z.string().max(20).optional()
export const ContactFilterSchema = z.object({ status: z.enum(['aktif', 'menunggu_persetujuan', 'tidak_aktif']).optional() }).strict()

export interface SafetyView {
  configured: boolean
  enabled: boolean
  tier: Tier
  ageDays: number
  activeDay: number
  dailyCap: number
  sentToday: number
  window: { start: string; end: string; timezone: string }
  minGapDays: number
}
export type Health = { level: 'aman' | 'hati-hati' | 'dijeda'; reason: string }
export interface OverviewView {
  contacts: Record<ContactStatus, number>
  suppressed: number
  pendingConfirm: number
  /** Automatic warm-up: contacts waiting for consent are asked, a little at a time, within the safety limits. */
  warmup: boolean
  safety: SafetyView
  health: Health
  runningCampaignId: number | null
}
export interface CampaignView extends Campaign { progress: Record<SendStatus, number> }
export interface ImportPreviewView {
  previewId: string
  total: number
  validCount: number
  invalidCount: number
  duplicates: number
  invalid: { row: number; value: string; reason: string }[]
  sample: { number: string; name: string }[]
}
export interface ReportView {
  campaign: Campaign
  progress: Record<SendStatus, number>
  skippedReasons: Record<string, number>
  optOuts: number
}
export type BroadcastEvent =
  | { type: 'progress'; campaignId: number; progress: Record<SendStatus, number> }
  | { type: 'paused'; campaignId: number; reason: string }
  | { type: 'done'; campaignId: number }

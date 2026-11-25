import { z } from 'zod'

/** Google Sheets connector: what the browser and the worker agree on. */

export type GsRole = 'knowledge' | 'catalog'
export type GsStatus = 'never' | 'syncing' | 'ok' | 'error' | 'needs_confirm'
export type GsError =
  | 'NO_CREDENTIAL' | 'INVALID_URL' | 'API_DISABLED' | 'NOT_SHARED' | 'NOT_FOUND' | 'RANGE_INVALID'
  | 'COLUMN_MISSING' | 'TOO_LARGE' | 'CREDENTIAL_INVALID' | 'RATE_LIMIT' | 'UPSTREAM' | 'EMPTY'

/** The product fields a sheet column can be mapped to (the names `parseCatalog` reads). */
export const CATALOG_FIELDS = ['id', 'nama', 'harga', 'deskripsi_singkat', 'checkout_url', 'cocok_untuk', 'stok'] as const
export type CatalogField = (typeof CATALOG_FIELDS)[number]

/** Plain-language text for each error; the worker and the browser use the same words. */
export const GS_MESSAGES: Record<GsError, string> = {
  NO_CREDENTIAL: 'Kunci akun layanan Google belum diunggah.',
  INVALID_URL: 'Tautan atau ID Google Sheets tidak valid.',
  API_DISABLED: 'Google Sheets API belum diaktifkan di proyek Google Cloud akun layanan ini.',
  NOT_SHARED: 'Sheet belum dibagikan ke akun layanan (sebagai Viewer), atau aksesnya sudah dicabut.',
  NOT_FOUND: 'Sheet atau tab tidak ditemukan. Mungkin sudah dihapus atau diganti nama.',
  RANGE_INVALID: 'Rentang sel tidak valid.',
  COLUMN_MISSING: 'Kolom yang dipetakan tidak ada lagi di sheet.',
  TOO_LARGE: 'Sheet melebihi batas ukuran (5.000 baris, 30 kolom, 5 MB teks).',
  CREDENTIAL_INVALID: 'Kunci akun layanan ditolak Google. Unggah kunci yang baru.',
  RATE_LIMIT: 'Google membatasi permintaan untuk sementara. Akan dicoba lagi.',
  UPSTREAM: 'Google Sheets tidak bisa dijangkau. Akan dicoba lagi.',
  EMPTY: 'Sheet kosong atau tidak ada baris yang valid.'
}

export const GS_LIMITS = { maxSources: 20, maxRows: 5000, maxCols: 30, maxBytes: 5 * 1024 * 1024, maxCell: 2000, minIntervalMin: 5, maxIntervalMin: 1440, defaultIntervalMin: 15 } as const

export interface GsSource {
  id: string
  name: string
  spreadsheetId: string
  gid: number
  tabTitle: string
  range: string | null
  role: GsRole
  /** Catalog: product field -> sheet column header. */
  mapping: Partial<Record<CatalogField, string>>
  /** Knowledge: the columns to keep (empty = all). */
  columns: string[]
  intervalMin: number
  enabled: boolean
  file: string
  lastSyncAt: number | null
  lastOkAt: number | null
  lastStatus: GsStatus
  lastError: GsError | null
  lastSummary: string | null
  rowCount: number
  consecutiveFailures: number
  pending: { reason: 'shrink' | 'domain'; summary: string } | null
  warnings: string[]
}

export interface GsTab { gid: number; title: string; rows: number; cols: number }
export type GsFail = { ok: false; error: GsError; message: string; clientEmail?: string }
export type GsInspectResult = { ok: true; spreadsheetId: string; title: string; tabs: GsTab[] } | GsFail
export type GsPreviewResult =
  | { ok: true; headers: string[]; rows: string[][]; totalRows: number; suggestedMapping: Partial<Record<CatalogField, string>>; problems: string[] }
  | GsFail
export type GsSaveCredentialResult =
  | { ok: true; clientEmail: string }
  | { ok: false; error: 'INVALID_JSON' | 'NOT_SERVICE_ACCOUNT' | 'TOO_LARGE'; message: string }
export interface GsCredentialStatus { configured: boolean; clientEmail?: string; addedAt?: number }

export interface GsSyncEvent { id: string; status: GsStatus; rowCount?: number; error?: GsError; at: number }

const a1 = /^[A-Za-z]{1,3}(\d{1,6})?(:[A-Za-z]{1,3}(\d{1,6})?)?$/
const columnName = z.string().trim().min(1).max(200)

export const SourceIdSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/)
export const SpreadsheetRefSchema = z.string().trim().min(1).max(400)
export const CredentialJsonSchema = z.string().max(10 * 1024)
export const DomainSchema = z.string().trim().toLowerCase().min(3).max(253)
  .regex(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, 'Domain tidak valid.')

const mapping = z.partialRecord(z.enum(CATALOG_FIELDS), columnName).default({})
const base = {
  gid: z.number().int().min(0),
  range: z.string().trim().regex(a1).nullable().optional().transform((v) => v ?? null),
  role: z.enum(['knowledge', 'catalog']),
  mapping,
  columns: z.array(columnName).max(GS_LIMITS.maxCols).default([])
}
export const PreviewInputSchema = z.object({ spreadsheetId: z.string().min(10).max(100), ...base }).strict()
export const AddSourceSchema = z.object({
  name: z.string().trim().min(1).max(80),
  spreadsheetId: z.string().min(10).max(100),
  tabTitle: z.string().trim().min(1).max(100),
  intervalMin: z.number().int().min(GS_LIMITS.minIntervalMin).max(GS_LIMITS.maxIntervalMin).default(GS_LIMITS.defaultIntervalMin),
  ...base
}).strict()
export const UpdateSourceSchema = z.object({
  name: z.string().trim().min(1).max(80),
  range: base.range,
  mapping,
  columns: base.columns,
  intervalMin: z.number().int().min(GS_LIMITS.minIntervalMin).max(GS_LIMITS.maxIntervalMin),
  enabled: z.boolean()
}).partial().strict()

export type PreviewInput = z.infer<typeof PreviewInputSchema>
export type AddSourceInput = z.infer<typeof AddSourceSchema>
export type UpdateSourceInput = z.infer<typeof UpdateSourceSchema>

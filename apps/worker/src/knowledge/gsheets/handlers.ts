import type { SecretStore } from '../../settings'
import type { InstanceMeta } from '../../instance-meta'
import { UserError } from '../../errors'
import {
  AddSourceSchema, CredentialJsonSchema, DomainSchema, GS_LIMITS, PreviewInputSchema, SourceIdSchema, SpreadsheetRefSchema,
  UpdateSourceSchema,
  type GsCredentialStatus, type GsFail, type GsInspectResult, type GsPreviewResult, type GsSaveCredentialResult, type GsSource
} from '@autobot/contracts/sheets'
import { GoogleAuth, parseServiceAccount, type ServiceAccountKey } from './auth'
import type { SheetsSource } from './client'
import { GsFailure } from './errors'
import { catalogJson, colIndex, suggestMapping, toTable } from './format'
import { parseSpreadsheetRef } from './ids'
import { fileFor, type SheetSyncService } from './sync'
import type { SourceStore } from './source-store'

export const CREDENTIAL_SECRET = 'google_sa'
const CREDENTIAL_AT = 'google_sa_at'

export interface GsHandlerDeps {
  store: SourceStore
  sync: SheetSyncService
  secrets: SecretStore
  meta: InstanceMeta
  auth: GoogleAuth
  source: () => SheetsSource
  clock: { now(): number }
}

/** The key as the auth code wants it; null when none is saved or the saved value is unusable. */
export function readKey(secrets: SecretStore): ServiceAccountKey | null {
  const raw = secrets.get(CREDENTIAL_SECRET)
  if (!raw) return null
  try { return JSON.parse(raw) as ServiceAccountKey } catch { return null }
}

const fail = (e: unknown, clientEmail?: string): GsFail => {
  if (e instanceof GsFailure) return { ok: false, error: e.code, message: e.message, clientEmail: e.code === 'NOT_SHARED' ? clientEmail : undefined }
  throw e
}

export function createGsHandlers(d: GsHandlerDeps) {
  const email = (): string | undefined => readKey(d.secrets)?.client_email
  const ref = (v: unknown): string => {
    const id = parseSpreadsheetRef(SpreadsheetRefSchema.parse(v))
    if (!id) throw new GsFailure('INVALID_URL')
    return id
  }

  return {
    gsCredentialStatus: (): GsCredentialStatus => {
      const k = readKey(d.secrets)
      if (!k) return { configured: false }
      const at = Number(d.meta.get(CREDENTIAL_AT))
      return { configured: true, clientEmail: k.client_email, addedAt: Number.isFinite(at) && at > 0 ? at : undefined }
    },

    gsSaveCredential: (json: unknown): GsSaveCredentialResult => {
      const parsedSize = CredentialJsonSchema.safeParse(json)
      if (!parsedSize.success) return { ok: false, error: 'TOO_LARGE', message: 'Berkas kunci terlalu besar.' }
      const k = parseServiceAccount(parsedSize.data)
      if (k === 'INVALID_JSON') return { ok: false, error: 'INVALID_JSON', message: 'Berkas bukan JSON yang valid.' }
      if (k === 'NOT_SERVICE_ACCOUNT') return { ok: false, error: 'NOT_SERVICE_ACCOUNT', message: 'Ini bukan kunci akun layanan Google (type service_account).' }
      d.secrets.set(CREDENTIAL_SECRET, JSON.stringify(k))
      d.meta.set(CREDENTIAL_AT, String(d.clock.now()))
      d.auth.forget()
      void d.sync.syncAll() // sources that were waiting for a key try again
      return { ok: true, clientEmail: k.client_email }
    },

    gsDeleteCredential: (): { ok: true } => {
      d.secrets.delete(CREDENTIAL_SECRET)
      d.auth.forget()
      return { ok: true }
    },

    gsInspect: async (urlOrId: unknown): Promise<GsInspectResult> => {
      try {
        const id = ref(urlOrId)
        const r = await d.source().inspect(id)
        return { ok: true, spreadsheetId: id, title: r.title, tabs: r.tabs }
      } catch (e) { return fail(e, email()) }
    },

    gsPreview: async (raw: unknown): Promise<GsPreviewResult> => {
      const i = PreviewInputSchema.parse(raw)
      try {
        const tab = (await d.source().inspect(i.spreadsheetId)).tabs.find((t) => t.gid === i.gid)
        if (!tab) throw new GsFailure('NOT_FOUND')
        const formatted = toTable(await d.source().read(i.spreadsheetId, tab.title, i.range, 'FORMATTED_VALUE'))
        const suggested = suggestMapping(formatted.headers)
        const problems: string[] = []
        if (i.role === 'catalog') {
          const mapping = Object.keys(i.mapping).length ? i.mapping : suggested
          try {
            const rawT = mapping.harga ? toTable(await d.source().read(i.spreadsheetId, tab.title, i.range, 'UNFORMATTED_VALUE')) : null
            const b = catalogJson(formatted, rawT, mapping, new Set(d.store.domains()))
            problems.push(...b.problems.slice(0, 10))
            if (b.unapprovedDomains.length) problems.push(`Domain checkout belum disetujui: ${b.unapprovedDomains.join(', ')}. Tautannya tidak akan dipakai.`)
          } catch (e) { if (e instanceof GsFailure) problems.push(e.message); else throw e }
        } else {
          for (const c of i.columns) if (colIndex(formatted, c) < 0) problems.push(`Kolom "${c}" tidak ditemukan.`)
          if (formatted.rows.length === 0) problems.push('Tidak ada baris data.')
        }
        return { ok: true, headers: formatted.headers, rows: formatted.rows.slice(0, 20), totalRows: formatted.rows.length, suggestedMapping: suggested, problems }
      } catch (e) { return fail(e, email()) }
    },

    gsListSources: (): GsSource[] => d.store.list(),

    gsAddSource: (raw: unknown): { id: string } => {
      const i = AddSourceSchema.parse(raw)
      if (d.store.count() >= GS_LIMITS.maxSources) throw new UserError(`Maksimal ${GS_LIMITS.maxSources} sumber.`)
      if (d.store.duplicate(i.spreadsheetId, i.gid, i.range)) throw new UserError('Tab ini sudah ditautkan.', 'CONFLICT')
      if (i.role === 'catalog' && (!i.mapping.id || !i.mapping.nama)) throw new UserError('Pilih kolom untuk id dan nama produk.')
      const file = fileFor(d.store, i.name, i.role)
      const id = d.store.insert({ ...i, file }, d.clock.now())
      void d.sync.syncNow(id)
      return { id }
    },

    gsUpdateSource: (id: unknown, raw: unknown): GsSource => {
      const sid = SourceIdSchema.parse(id)
      const patch = UpdateSourceSchema.parse(raw)
      const cur = d.store.get(sid)
      if (!cur) throw new UserError('Sumber tidak ditemukan.', 'NOT_FOUND')
      d.store.update(sid, patch)
      if (patch.mapping || patch.columns || patch.range !== undefined) void d.sync.syncNow(sid)
      return d.store.get(sid)!
    },

    gsRemoveSource: async (id: unknown): Promise<{ ok: true }> => {
      await d.sync.remove(SourceIdSchema.parse(id))
      return { ok: true }
    },

    gsSyncNow: (id: unknown): { started: true } => {
      const sid = SourceIdSchema.parse(id)
      if (!d.store.get(sid)) throw new UserError('Sumber tidak ditemukan.', 'NOT_FOUND')
      void d.sync.syncNow(sid)
      return { started: true }
    },

    gsConfirmChange: async (id: unknown): Promise<{ ok: true }> => {
      const sid = SourceIdSchema.parse(id)
      if (!d.store.get(sid)) throw new UserError('Sumber tidak ditemukan.', 'NOT_FOUND')
      await d.sync.confirm(sid)
      return { ok: true }
    },

    gsDismissChange: (id: unknown): { ok: true } => {
      d.sync.dismiss(SourceIdSchema.parse(id))
      return { ok: true }
    },

    /** A new domain may unlock links in catalog sources, so those sync again right away. */
    gsApproveDomain: (domain: unknown): { ok: true } => {
      d.store.approveDomain(DomainSchema.parse(domain), d.clock.now())
      for (const s of d.store.list()) if (s.role === 'catalog' && s.enabled) void d.sync.syncNow(s.id)
      return { ok: true }
    },

    gsListApprovedDomains: (): string[] => d.store.domains()
  }
}

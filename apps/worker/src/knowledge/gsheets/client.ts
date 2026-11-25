import type { GsTab } from '@autobot/contracts/sheets'
import type { FetchFn, GoogleAuth } from './auth'
import { GsFailure } from './errors'

export type Cell = string | number | boolean
export type Render = 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE'

/** What the sync needs from Google. A fake replaces it in tests. */
export interface SheetsSource {
  inspect(spreadsheetId: string): Promise<{ title: string; tabs: GsTab[] }>
  /** The cells of one tab (or a range of it) as rows. */
  read(spreadsheetId: string, tabTitle: string, range: string | null, render: Render): Promise<Cell[][]>
}

const API = 'https://sheets.googleapis.com/v4/spreadsheets'

/** 'My tab'!A1:F  (a quote inside the title is doubled, as A1 notation requires). */
export const a1Range = (tab: string, range: string | null): string => `'${tab.replace(/'/g, "''")}'${range ? `!${range}` : ''}`

export class SheetsClient implements SheetsSource {
  constructor(private auth: GoogleAuth, private fetchFn: FetchFn = fetch) {}

  private async get(url: string, spreadsheetId: string): Promise<any> {
    const token = await this.auth.token()
    let res: Response
    try {
      res = await this.fetchFn(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) })
    } catch { throw new GsFailure('UPSTREAM') }
    if (res.ok) return res.json()
    const body = (await res.json().catch(() => null)) as { error?: { status?: string; message?: string } } | null
    const text = `${body?.error?.status ?? ''} ${body?.error?.message ?? ''}`
    if (res.status === 401) { this.auth.forget(); throw new GsFailure('CREDENTIAL_INVALID') }
    if (res.status === 403) {
      if (/SERVICE_DISABLED|has not been used|is disabled/i.test(text)) throw new GsFailure('API_DISABLED')
      if (/RATE_LIMIT|quota/i.test(text)) throw new GsFailure('RATE_LIMIT')
      throw new GsFailure('NOT_SHARED')
    }
    if (res.status === 404) throw new GsFailure('NOT_FOUND')
    if (res.status === 400) throw new GsFailure(/range/i.test(text) ? 'RANGE_INVALID' : 'UPSTREAM')
    if (res.status === 429) throw new GsFailure('RATE_LIMIT')
    void spreadsheetId
    throw new GsFailure('UPSTREAM')
  }

  async inspect(id: string): Promise<{ title: string; tabs: GsTab[] }> {
    const fields = encodeURIComponent('properties.title,sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))')
    const j = await this.get(`${API}/${encodeURIComponent(id)}?fields=${fields}`, id)
    const tabs: GsTab[] = (j.sheets ?? []).map((s: any) => ({
      gid: Number(s.properties?.sheetId ?? 0), title: String(s.properties?.title ?? ''),
      rows: Number(s.properties?.gridProperties?.rowCount ?? 0), cols: Number(s.properties?.gridProperties?.columnCount ?? 0)
    }))
    return { title: String(j.properties?.title ?? ''), tabs }
  }

  async read(id: string, tabTitle: string, range: string | null, render: Render): Promise<Cell[][]> {
    const q = new URLSearchParams({ ranges: a1Range(tabTitle, range), valueRenderOption: render, majorDimension: 'ROWS' })
    const j = await this.get(`${API}/${encodeURIComponent(id)}/values:batchGet?${q}`, id)
    return (j.valueRanges?.[0]?.values ?? []) as Cell[][]
  }
}

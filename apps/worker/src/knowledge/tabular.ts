import readExcel from 'read-excel-file/node'

export type Row = Record<string, unknown>

/** Minimal RFC 4180 CSV parser (quotes, escaped quotes, CRLF, BOM). Replaces SheetJS for .csv. */
export function parseCsvRows(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++ } else quoted = false
      } else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell); cell = ''
      rows.push(row); row = []
    } else cell += c
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows.filter((r) => r.some((v) => v.trim() !== ''))
}

/** First row is the header; later rows become objects keyed by header. Empty cells become ''. */
export function matrixToObjects(matrix: unknown[][]): Row[] {
  const [header, ...body] = matrix
  if (!header) return []
  const keys = header.map((h) => String(h ?? '').trim())
  return body
    .filter((r) => r.some((v) => v != null && String(v).trim() !== ''))
    .map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ''] as const).filter(([k]) => k !== '')))
}

export const csvToObjects = (text: string): Row[] => matrixToObjects(parseCsvRows(text))

export async function xlsxSheetsToObjects(buf: Buffer): Promise<Row[][]> {
  const sheets = (await readExcel(buf)) as { sheet: string; data: unknown[][] }[]
  return sheets.map((s) => matrixToObjects(s.data))
}

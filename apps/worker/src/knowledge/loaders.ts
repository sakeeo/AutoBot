import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { csvToObjects, xlsxSheetsToObjects } from './tabular'

export const SUPPORTED_EXTENSIONS = ['.md', '.txt', '.pdf', '.docx', '.csv', '.xlsx', '.json'] as const
const MAX_BYTES = 20 * 1024 * 1024

export type LoaderErrorCode = 'EMPTY' | 'UNSUPPORTED' | 'TOO_LARGE' | 'PARSE_FAILED'

export class LoaderError extends Error {
  constructor(public code: LoaderErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'LoaderError'
  }
}

function rowsToLines(rows: Record<string, unknown>[]): string {
  return rows
    .map((r) =>
      Object.entries(r)
        .filter(([, v]) => v !== '' && v != null)
        .map(([k, v]) => `${k}: ${v}`)
        .join('; ')
    )
    .filter(Boolean)
    .join('\n')
}

async function readText(path: string, ext: string): Promise<string> {
  switch (ext) {
    case '.md':
    case '.txt':
    case '.json':
      return readFile(path, 'utf8')
    case '.csv':
      return rowsToLines(csvToObjects(await readFile(path, 'utf8')))
    case '.xlsx':
      return (await xlsxSheetsToObjects(await readFile(path))).map(rowsToLines).join('\n')
    case '.docx': {
      const mammoth = await import('mammoth')
      return (await mammoth.extractRawText({ path })).value
    }
    case '.pdf': {
      const { PDFParse } = await import('pdf-parse')
      const parser = new PDFParse({ data: new Uint8Array(await readFile(path)) })
      try {
        return (await parser.getText()).text
      } finally {
        await parser.destroy().catch(() => undefined)
      }
    }
    default:
      throw new LoaderError('UNSUPPORTED', ext)
  }
}

export async function loadDocument(path: string): Promise<{ text: string }> {
  const ext = extname(path).toLowerCase()
  if (!(SUPPORTED_EXTENSIONS as readonly string[]).includes(ext)) throw new LoaderError('UNSUPPORTED', ext)
  if ((await stat(path)).size > MAX_BYTES) throw new LoaderError('TOO_LARGE')
  let text: string
  try {
    text = await readText(path, ext)
  } catch (e) {
    if (e instanceof LoaderError) throw e
    throw new LoaderError('PARSE_FAILED', (e as Error).message)
  }
  if (!text.trim()) throw new LoaderError('EMPTY')
  return { text }
}

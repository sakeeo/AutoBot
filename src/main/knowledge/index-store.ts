import type { Db } from '../db'
import type { Hit } from '../../shared/types'
import { tokenize, normalizeTokens, isStopword } from '../answer/tokenize'

export interface FileInfo {
  file: string
  status: 'indexed' | 'failed'
  chunks: number
  reason?: string
}

/** Optimal-string-alignment distance (insert/delete/substitute/transpose), stopping early past `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}

const maxTypos = (len: number): number => (len >= 8 ? 2 : len >= 4 ? 1 : 0)

export class IndexStore {
  private vocab: string[] | null = null

  constructor(private db: Db) {}

  /** Content words found in the indexed documents (stopwords left out); rebuilt after any change. */
  private vocabulary(): string[] {
    if (!this.vocab) {
      const set = new Set<string>()
      const rows = this.db.prepare('SELECT text FROM chunks').all() as { text: string }[]
      for (const r of rows) for (const w of normalizeTokens(r.text)) if (w.length >= 3 && !isStopword(w)) set.add(w)
      this.vocab = [...set]
    }
    return this.vocab
  }

  /** The token itself plus, when the documents do not contain it, document words a typo away from it. */
  private variants(token: string): string[] {
    const vocab = this.vocabulary()
    if (vocab.some((w) => w === token || (token.length >= 4 && w.startsWith(token)))) return [token]
    const max = maxTypos(token.length)
    if (max === 0) return [token]
    return [token, ...vocab.filter((w) => editDistance(token, w, max) <= max)]
  }

  replaceFile(file: string, mtimeMs: number, chunks: string[]): void {
    this.vocab = null
    this.db.transaction(() => {
      this.deleteChunks(file)
      this.db
        .prepare(
          `INSERT INTO files(file, mtime_ms, status, reason) VALUES (?, ?, 'indexed', NULL)
           ON CONFLICT(file) DO UPDATE SET mtime_ms = excluded.mtime_ms, status = 'indexed', reason = NULL`
        )
        .run(file, mtimeMs)
      const insChunk = this.db.prepare('INSERT INTO chunks(file, text) VALUES (?, ?)')
      const insFts = this.db.prepare('INSERT INTO chunks_fts(rowid, text) VALUES (?, ?)')
      for (const text of chunks) {
        const id = insChunk.run(file, text).lastInsertRowid
        insFts.run(id, text)
      }
    })()
  }

  removeFile(file: string): void {
    this.vocab = null
    this.db.transaction(() => {
      this.deleteChunks(file)
      this.db.prepare('DELETE FROM files WHERE file = ?').run(file)
    })()
  }

  markFailed(file: string, reason: string): void {
    this.vocab = null
    this.db.transaction(() => {
      this.deleteChunks(file)
      this.db
        .prepare(
          `INSERT INTO files(file, mtime_ms, status, reason) VALUES (?, 0, 'failed', ?)
           ON CONFLICT(file) DO UPDATE SET status = 'failed', reason = excluded.reason`
        )
        .run(file, reason)
    })()
  }

  getMtime(file: string): number | null {
    const r = this.db.prepare("SELECT mtime_ms FROM files WHERE file = ? AND status = 'indexed'").get(file) as
      | { mtime_ms: number }
      | undefined
    return r ? r.mtime_ms : null
  }

  listFiles(): FileInfo[] {
    const rows = this.db
      .prepare(
        `SELECT f.file, f.status, f.reason, (SELECT COUNT(*) FROM chunks c WHERE c.file = f.file) AS chunks
         FROM files f ORDER BY f.file`
      )
      .all() as { file: string; status: 'indexed' | 'failed'; reason: string | null; chunks: number }[]
    return rows.map((r) => ({
      file: r.file,
      status: r.status,
      chunks: r.chunks,
      ...(r.reason ? { reason: r.reason } : {})
    }))
  }

  search(query: string, k: number): Hit[] {
    const tokens = tokenize(query)
    if (tokens.length === 0) return []
    const variants = new Map(tokens.map((t) => [t, this.variants(t)]))
    const match = [...new Set([...variants.values()].flat())].map((t) => `"${t}"*`).join(' OR ')
    const rows = this.db
      .prepare(
        `SELECT c.id AS id, c.file AS file, c.text AS text, bm25(chunks_fts) AS rank
         FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid
         WHERE chunks_fts MATCH ? ORDER BY rank LIMIT 50`
      )
      .all(match) as { id: number; file: string; text: string; rank: number }[]
    const hits: Hit[] = rows.map((r) => {
      const words = normalizeTokens(r.text)
      const matched = tokens.filter((t) =>
        variants.get(t)!.some((v) => words.some((w) => w === v || (v.length >= 4 && w.startsWith(v))))
      )
      return { chunkId: r.id, file: r.file, text: r.text, coverage: matched.length / tokens.length, rank: r.rank }
    })
    hits.sort((a, b) => b.coverage - a.coverage || a.rank - b.rank)
    return hits.slice(0, k)
  }

  private deleteChunks(file: string): void {
    const ids = this.db.prepare('SELECT id FROM chunks WHERE file = ?').all(file) as { id: number }[]
    const del = this.db.prepare('DELETE FROM chunks_fts WHERE rowid = ?')
    for (const { id } of ids) del.run(id)
    this.db.prepare('DELETE FROM chunks WHERE file = ?').run(file)
  }
}

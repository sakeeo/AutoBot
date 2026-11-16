import type { Db } from '../db'
import type { Hit } from '../../shared/types'
import { tokenize, normalizeTokens } from '../answer/tokenize'

export interface FileInfo {
  file: string
  status: 'indexed' | 'failed'
  chunks: number
  reason?: string
}

export class IndexStore {
  constructor(private db: Db) {}

  replaceFile(file: string, mtimeMs: number, chunks: string[]): void {
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
    this.db.transaction(() => {
      this.deleteChunks(file)
      this.db.prepare('DELETE FROM files WHERE file = ?').run(file)
    })()
  }

  markFailed(file: string, reason: string): void {
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
    const match = tokens.map((t) => `"${t}"*`).join(' OR ')
    const rows = this.db
      .prepare(
        `SELECT c.id AS id, c.file AS file, c.text AS text, bm25(chunks_fts) AS rank
         FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid
         WHERE chunks_fts MATCH ? ORDER BY rank LIMIT 50`
      )
      .all(match) as { id: number; file: string; text: string; rank: number }[]
    const hits: Hit[] = rows.map((r) => {
      const words = normalizeTokens(r.text)
      const matched = tokens.filter((t) => words.some((w) => w === t || (t.length >= 4 && w.startsWith(t))))
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

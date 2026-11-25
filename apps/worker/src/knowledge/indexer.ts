import { EventEmitter } from 'node:events'
import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, relative, sep } from 'node:path'
import ignore, { type Ignore } from 'ignore'
import { chunkText } from './chunker'
import type { IndexStore } from './index-store'
import { loadDocument, LoaderError, SUPPORTED_EXTENSIONS } from './loaders'

/** Never indexed, whatever else is configured. */
const ALWAYS_EXCLUDED = ['.env', '.env.*', '*.key', '*.pem', 'node_modules/', '.git/']

export interface IndexStatusEvent {
  file: string
  status: 'indexed' | 'failed' | 'removed'
  reason?: string
}

const normalizePath = (file: string): string => file.replace(/\\/g, '/')

/**
 * Indexes the one managed knowledge folder. There is no file watcher: whoever writes a file (an upload, a Google Sheets
 * sync) calls `indexFile` right after, and `reindexAll` rebuilds everything on demand. Fewer moving parts than a watcher
 * in a container, and the caller knows exactly when a file is complete.
 */
export class Indexer extends EventEmitter {
  private root: string
  private ig: Ignore
  private onDocument?: (file: string, raw: string, ext: string) => void
  private onRemove?: (file: string) => void

  constructor(
    private store: IndexStore,
    opts: {
      root: string
      exclude?: string[]
      /** Called with the raw text of every successfully indexed .csv/.json file (e.g. for the product catalog). */
      onDocument?: (file: string, raw: string, ext: string) => void
      onRemove?: (file: string) => void
    }
  ) {
    super()
    this.root = normalizePath(opts.root)
    this.ig = ignore().add([...ALWAYS_EXCLUDED, ...(opts.exclude ?? [])])
    this.onDocument = opts.onDocument
    this.onRemove = opts.onRemove
  }

  /** Creates the folder if needed and indexes what is in it. */
  async start(): Promise<void> {
    await mkdir(this.root, { recursive: true })
    await this.scan(this.root, false)
  }

  async stop(): Promise<void> {
    /* nothing runs in the background */
  }

  async reindexAll(): Promise<void> {
    await this.scan(this.root, true)
  }

  private isExcluded(file: string): boolean {
    const rel = normalizePath(relative(this.root, file)).split(sep).join('/')
    return rel === '' || rel.startsWith('..') || this.ig.ignores(rel)
  }

  private async scan(dir: string, force: boolean): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = normalizePath(join(dir, e.name))
      if (e.isDirectory()) {
        const rel = normalizePath(relative(this.root, full)).split(sep).join('/')
        if (this.ig.ignores(rel + '/')) continue
        await this.scan(full, force)
      } else if (e.isFile()) {
        await this.indexFile(full, force)
      }
    }
  }

  /** Indexes one file (skipped when unchanged unless `force`). Never throws: a bad file is recorded as failed. */
  async indexFile(file: string, force = false): Promise<void> {
    const normalized = normalizePath(file)
    if (this.isExcluded(normalized)) return
    if (!(SUPPORTED_EXTENSIONS as readonly string[]).includes(extname(normalized).toLowerCase())) return
    try {
      const mtime = (await stat(normalized)).mtimeMs
      if (!force && this.store.getMtime(normalized) === mtime) return
      const { text } = await loadDocument(normalized)
      const chunks = chunkText(text)
      this.store.replaceFile(normalized, mtime, chunks)
      const ext = extname(normalized).toLowerCase()
      if (this.onDocument && (ext === '.csv' || ext === '.json'))
        this.onDocument(normalized, await readFile(normalized, 'utf8'), ext)
      this.emit('status', { file: normalized, status: 'indexed' } satisfies IndexStatusEvent)
    } catch (e) {
      const reason = e instanceof LoaderError ? e.code : 'PARSE_FAILED'
      this.store.markFailed(normalized, reason)
      this.emit('status', { file: normalized, status: 'failed', reason } satisfies IndexStatusEvent)
    }
  }

  /** Drops a file from the index (the caller deletes the file itself). */
  async removeFile(file: string): Promise<void> {
    const normalized = normalizePath(file)
    this.store.removeFile(normalized)
    this.onRemove?.(normalized)
    this.emit('status', { file: normalized, status: 'removed' } satisfies IndexStatusEvent)
  }
}

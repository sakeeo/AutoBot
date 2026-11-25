interface Tok {
  w: string
  /** separator after this word: '\n' if the source had a line break, else ' ' */
  sep: string
}

function tokens(text: string): Tok[] {
  return [...text.matchAll(/(\S+)(\s*)/g)].map((m) => ({ w: m[1], sep: m[2].includes('\n') ? '\n' : ' ' }))
}

function join(ts: Tok[]): string {
  return ts.map((t, i) => (i < ts.length - 1 ? t.w + t.sep : t.w)).join('')
}

export function chunkText(text: string, opts: { size?: number; overlap?: number } = {}): string[] {
  const size = opts.size ?? 500
  const overlap = Math.min(opts.overlap ?? 80, size - 1)
  const toks = tokens(text)
  if (toks.length === 0) return []
  if (toks.length <= size) return [join(toks)]
  const chunks: string[] = []
  const step = size - overlap
  for (let start = 0; start < toks.length; start += step) {
    chunks.push(join(toks.slice(start, start + size)))
    if (start + size >= toks.length) break
  }
  return chunks
}

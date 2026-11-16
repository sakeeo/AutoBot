export function chunkText(text: string, opts: { size?: number; overlap?: number } = {}): string[] {
  const size = opts.size ?? 500
  const overlap = Math.min(opts.overlap ?? 80, size - 1)
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  if (words.length <= size) return [words.join(' ')]
  const chunks: string[] = []
  const step = size - overlap
  for (let start = 0; start < words.length; start += step) {
    chunks.push(words.slice(start, start + size).join(' '))
    if (start + size >= words.length) break
  }
  return chunks
}

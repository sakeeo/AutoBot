import { basename } from 'node:path'
import type { Answer, Hit } from '@autobot/contracts/types'
import { normalizeTokens, tokenize } from './tokenize'

const MAX_BODY = 600
const MAX_SENTENCES = 3

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function buildExtractiveAnswer(query: string, hits: Hit[]): Answer {
  const tokens = tokenize(query)
  const scored = hits.flatMap((h) =>
    sentences(h.text).map((s, i) => {
      const words = normalizeTokens(s)
      const score = tokens.filter((t) => words.some((w) => w === t || (t.length >= 4 && w.startsWith(t)))).length
      return { s, i, score, chunk: h.chunkId }
    })
  )
  const bestChunk = scored.reduce((m, x) => (x.score > (m?.score ?? 0) ? x : m), undefined as (typeof scored)[number] | undefined)
  let body: string
  if (bestChunk) {
    body = scored
      .filter((x) => x.chunk === bestChunk.chunk && x.score > 0)
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .slice(0, MAX_SENTENCES)
      .sort((a, b) => a.i - b.i)
      .map((x) => x.s)
      .join(' ')
  } else {
    body = hits[0]?.text ?? ''
  }
  body = body.slice(0, MAX_BODY)
  const sources = [...new Set(hits.map((h) => basename(h.file)))]
  return { text: `${body}\n\nSumber: ${sources.join(', ')}`, sources }
}

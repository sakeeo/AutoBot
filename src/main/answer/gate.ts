import type { Decision, Hit } from '../../shared/types'
import { tokenize } from './tokenize'

const MAX_HITS = 5

export function decide(message: string, hits: Hit[], threshold: number): Decision {
  if (tokenize(message).length === 0) return { kind: 'out_of_context', reason: 'no_tokens' }
  if (hits.length === 0) return { kind: 'out_of_context', reason: 'no_hits' }
  const best = Math.max(...hits.map((h) => h.coverage))
  if (best < threshold) return { kind: 'out_of_context', reason: 'below_threshold' }
  return { kind: 'answerable', hits: hits.filter((h) => h.coverage >= threshold).slice(0, MAX_HITS) }
}

import { PROVIDERS, resolveBaseUrl } from '../../shared/providers'
import type { Settings } from '../../shared/types'
import { ClaudeProvider, type AiProvider } from './ai-answerer'
import { OpenAiCompatProvider } from './openai-provider'

export function makeProvider(ai: Pick<Settings['ai'], 'provider' | 'baseUrl'>, key: string): AiProvider {
  const info = PROVIDERS[ai.provider]
  if (info.kind === 'anthropic') return new ClaudeProvider(key)
  return new OpenAiCompatProvider(key, resolveBaseUrl(ai.provider, ai.baseUrl), info.tokenParam)
}

export const PROVIDER_IDS = ['claude', 'openai', 'deepseek', 'gemini', 'groq', 'openrouter', 'custom'] as const
export type ProviderId = (typeof PROVIDER_IDS)[number]

export interface ProviderInfo {
  id: ProviderId
  label: string
  /** 'anthropic' = Anthropic Messages API; 'openai' = OpenAI-compatible /chat/completions. */
  kind: 'anthropic' | 'openai'
  baseUrl: string
  defaultModel: string
  consoleUrl: string | null
  keyPlaceholder: string
  /** OpenAI itself requires max_completion_tokens on newer models; most compatible APIs only know max_tokens. */
  tokenParam?: 'max_tokens' | 'max_completion_tokens'
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  claude: {
    id: 'claude', label: 'Claude (Anthropic)', kind: 'anthropic', baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-haiku-5-5', consoleUrl: 'https://console.anthropic.com/settings/keys', keyPlaceholder: 'sk-ant-…'
  },
  openai: {
    id: 'openai', label: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini', consoleUrl: 'https://platform.openai.com/api-keys', keyPlaceholder: 'sk-…',
    tokenParam: 'max_completion_tokens'
  },
  deepseek: {
    id: 'deepseek', label: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat', consoleUrl: 'https://platform.deepseek.com/api_keys', keyPlaceholder: 'sk-…'
  },
  gemini: {
    id: 'gemini', label: 'Google Gemini', kind: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.0-flash', consoleUrl: 'https://aistudio.google.com/apikey', keyPlaceholder: 'AIza…'
  },
  groq: {
    id: 'groq', label: 'Groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile', consoleUrl: 'https://console.groq.com/keys', keyPlaceholder: 'gsk_…'
  },
  openrouter: {
    id: 'openrouter', label: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o-mini', consoleUrl: 'https://openrouter.ai/keys', keyPlaceholder: 'sk-or-…'
  },
  custom: {
    id: 'custom', label: 'Kustom (kompatibel OpenAI)', kind: 'openai', baseUrl: '',
    defaultModel: '', consoleUrl: null, keyPlaceholder: 'API key'
  }
}

/** Claude keeps its legacy secret name so existing installs keep working. */
export function secretNameFor(id: ProviderId): string {
  return id === 'claude' ? 'anthropic_api_key' : `ai_key_${id}`
}

/** Endpoint for a provider; only 'custom' uses the user-supplied base URL. */
export function resolveBaseUrl(id: ProviderId, custom?: string): string {
  return (id === 'custom' ? custom ?? '' : PROVIDERS[id].baseUrl).replace(/\/+$/, '')
}

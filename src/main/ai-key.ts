import { ApiKeySchema } from '../shared/ipc'
import { toAiError, type AiProvider } from './answer/ai-answerer'
import type { SecretStore } from './settings'

export const API_KEY_SECRET = 'anthropic_api_key'

const MESSAGES = {
  INVALID: 'API key tidak valid.',
  AUTH: 'API key ditolak oleh penyedia. Periksa kembali key Anda.',
  RATE_LIMIT: 'Penyedia membatasi permintaan. Coba lagi beberapa saat lagi.',
  TIMEOUT: 'Koneksi ke penyedia habis waktu. Coba lagi.',
  NETWORK: 'Tidak bisa terhubung ke penyedia. Periksa koneksi internet.'
} as const

/** Tests the key with one tiny call and stores it (encrypted) only if the provider accepts it. */
export async function saveApiKey(
  deps: {
    secrets: SecretStore
    makeProvider: (key: string) => AiProvider
    ai: { model: string; maxTokens: number }
  },
  key: string
): Promise<{ ok: boolean; error?: string }> {
  const parsed = ApiKeySchema.safeParse(key)
  if (!parsed.success) return { ok: false, error: MESSAGES.INVALID }
  try {
    await deps.makeProvider(parsed.data).complete({
      system: 'Balas dengan satu kata: pong',
      user: 'ping',
      model: deps.ai.model,
      maxTokens: 16
    })
  } catch (e) {
    return { ok: false, error: MESSAGES[toAiError(e).code] }
  }
  deps.secrets.set(API_KEY_SECRET, parsed.data)
  return { ok: true }
}

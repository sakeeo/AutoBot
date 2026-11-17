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

/** The models a stored or candidate key can use, or the reason they could not be listed. */
export async function listModels(
  provider: AiProvider
): Promise<{ ok: true; models: string[] } | { ok: false; error: string; code: keyof typeof MESSAGES }> {
  if (!provider.listModels) return { ok: false, error: 'Penyedia ini tidak menyediakan daftar model.', code: 'NETWORK' }
  try {
    return { ok: true, models: await provider.listModels() }
  } catch (e) {
    const code = toAiError(e).code
    return { ok: false, error: MESSAGES[code], code }
  }
}

/**
 * Step 1 of the flow: connect. The key is checked by asking the provider for its models (no model needed yet) and
 * stored (encrypted) only if the provider accepts it; the list comes back so the person can pick one in step 2.
 * A provider that cannot list models is checked with one tiny test call instead, using the saved model name.
 */
export async function saveApiKey(
  deps: {
    secrets: SecretStore
    makeProvider: (key: string) => AiProvider
    ai: { model: string; maxTokens: number }
    /** Secret slot for the selected provider; defaults to the legacy Claude slot. */
    secretName?: string
    /** Set when the provider needs extra config (custom endpoint) that is still missing. */
    configError?: string
  },
  key: string
): Promise<{ ok: boolean; error?: string; models?: string[] }> {
  if (deps.configError) return { ok: false, error: deps.configError }
  const parsed = ApiKeySchema.safeParse(key)
  if (!parsed.success) return { ok: false, error: MESSAGES.INVALID }
  const provider = deps.makeProvider(parsed.data)
  const store = (): void => deps.secrets.set(deps.secretName ?? API_KEY_SECRET, parsed.data)

  if (provider.listModels) {
    const listed = await listModels(provider)
    if (listed.ok && listed.models.length > 0) {
      store()
      return { ok: true, models: listed.models }
    }
    // A rejected key, a rate limit or a timeout is final. Only "this server cannot list models" falls through.
    if (!listed.ok && (listed.code === 'AUTH' || listed.code === 'RATE_LIMIT' || listed.code === 'TIMEOUT'))
      return { ok: false, error: listed.error }
  }

  if (!deps.ai.model.trim()) return { ok: false, error: 'Daftar model tidak tersedia. Isi nama model terlebih dahulu, lalu hubungkan lagi.' }
  try {
    await provider.complete({ system: 'Balas dengan satu kata: pong', user: 'ping', model: deps.ai.model, maxTokens: 16 })
  } catch (e) {
    return { ok: false, error: MESSAGES[toAiError(e).code] }
  }
  store()
  return { ok: true }
}

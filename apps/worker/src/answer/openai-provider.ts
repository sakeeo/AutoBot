import type { AiProvider } from './ai-answerer'
import { chatModelIds } from './model-list'

/** Any OpenAI-compatible /chat/completions endpoint (OpenAI, DeepSeek, Gemini, Groq, OpenRouter, Ollama…). */
export class OpenAiCompatProvider implements AiProvider {
  constructor(
    private apiKey: string,
    private baseUrl: string,
    private tokenParam: 'max_tokens' | 'max_completion_tokens' = 'max_tokens'
  ) {}

  async complete(req: { system: string; user: string; model: string; maxTokens: number }): Promise<string> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: req.model,
        [this.tokenParam]: req.maxTokens,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user }
        ]
      }),
      signal: AbortSignal.timeout(90_000)
    })
    if (!res.ok) {
      // Status drives error mapping; the body is never echoed (it can reflect request details).
      throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status })
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string | null } }[] }
    return json.choices?.[0]?.message?.content ?? ''
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/models`, {
      headers: { authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(15_000)
    })
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status })
    const json = (await res.json()) as { data?: { id?: unknown }[]; models?: { name?: unknown }[] }
    const raw = (json.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string')
    // Ollama's native shape, in case the endpoint answers with it.
    const alt = (json.models ?? []).map((m) => m.name).filter((n): n is string => typeof n === 'string')
    return chatModelIds([...raw, ...alt])
  }
}

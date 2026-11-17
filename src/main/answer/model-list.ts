/** Ids that are not chat models (embeddings, speech, images, moderation, …) and would only fail if picked. */
const NOT_CHAT = /embed|whisper|tts|dall-e|moderation|davinci|babbage|realtime|audio|transcribe|imagen|veo|aqa|guard|rerank|image/i

/** Turns a provider's raw model ids into the list a person can pick from: unique, chat-capable, sorted. */
export function chatModelIds(raw: string[]): string[] {
  const ids = raw.map((id) => id.replace(/^models\//, '').trim()).filter((id) => id !== '' && !NOT_CHAT.test(id))
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b))
}

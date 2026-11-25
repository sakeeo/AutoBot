const clean = (s: string): string =>
  s
    .replace(/\*\*(.+?)\*\*/gs, '$1')
    .replace(/__(.+?)__/gs, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .trim()

/** Turns the model's reply parts into at most `maxBubbles` plain-text chat bubbles. */
export function splitBubbles(parts: string[], maxBubbles = 3): string[] {
  const cleaned = parts.map(clean).filter((s) => s !== '')
  if (cleaned.length <= maxBubbles) return cleaned
  return [...cleaned.slice(0, maxBubbles - 1), cleaned.slice(maxBubbles - 1).join(' ')]
}

const MIN_TYPING_MS = 1000
const MAX_TYPING_MS = 6000

/** 40–60 ms per character, clamped to 1–6 seconds. */
export function typingMsFor(text: string, rand: () => number = Math.random): number {
  const ms = text.length * (40 + rand() * 20)
  return Math.round(Math.min(MAX_TYPING_MS, Math.max(MIN_TYPING_MS, ms)))
}

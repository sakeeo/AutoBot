const STOPWORDS = new Set(
  (
    'yang dan di ke dari untuk apa berapa bisa ada apakah saya aku kamu anda kak kakak min admin mas mbak pak bu ' +
    'dong deh sih nih tuh ya yaa yah iya ok oke okey oks siapa kapan dimana mana bagaimana gimana kenapa mengapa ' +
    'dengan pada dalam atau juga sudah belum akan masih lagi lah kah pun ini itu tersebut sebuah para ' +
    'tolong mohon minta boleh mau ingin pengen butuh tanya nanya info informasi ' +
    'halo hai hi hello hey selamat pagi siang sore malam assalamualaikum waalaikumsalam salam ' +
    'terima kasih makasih thanks thank thx ' +
    'the is are was were be to of in on at for and or a an it this that what how when where who why can could ' +
    'do does did have has had i you we they me my your please hi hello ok okay yes no not with from by as'
  ).split(/\s+/)
)

const CLITICS = ['nya', 'kah', 'lah', 'pun']

function stem(token: string): string {
  for (const c of CLITICS) {
    if (token.length - c.length >= 3 && token.endsWith(c)) return token.slice(0, -c.length)
  }
  return token
}

/** Lowercase word tokens (letters/digits), clitic-stripped, without stopword removal. */
export function normalizeTokens(text: string): string[] {
  const raw = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  return raw.map(stem)
}

/** Content tokens of a message: stemmed, stopwords and 1-char tokens removed, deduplicated. */
export function tokenize(text: string): string[] {
  const raw = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  const out = new Set<string>()
  for (const r of raw) {
    if (STOPWORDS.has(r)) continue
    const s = stem(r)
    if (s.length < 2 || STOPWORDS.has(s)) continue
    out.add(s)
  }
  return [...out]
}

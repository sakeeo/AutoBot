export const OPTOUT_FOOTER = 'Balas BERHENTI untuk tidak menerima pesan ini lagi.'
const MAX_LENGTH = 600
const SHORTENERS = ['bit.ly', 'tinyurl.com', 't.co', 's.id', 'cutt.ly', 'rebrand.ly', 'goo.gl', 'is.gd', 'ow.ly', 'shorturl.at']

export function renderTemplate(tpl: string, vars: { nama?: string; bisnis: string } & Record<string, string | undefined>): string {
  return tpl
    .replace(/\{([a-z0-9_]+)\}/gi, (_m, k: string) => vars[k] ?? '')
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/g, '').replace(/^[ \t]+/g, ''))
    .join('\n')
    .trim()
}

/** The opt-out sentence is always the last thing in a broadcast; it cannot be moved, edited or hidden. */
export function withFooter(text: string): string {
  const t = text.trimEnd()
  return t.endsWith(OPTOUT_FOOTER) ? t : `${t}\n\n${OPTOUT_FOOTER}`
}

const hostOf = (url: string): string => {
  const m = /^(?:https?:\/\/)?([^/\s?#]+)/i.exec(url)
  return (m?.[1] ?? '').toLowerCase().replace(/^www\./, '')
}

export function lintMessage(
  text: string,
  ctx: { businessName: string; lastCampaignText?: string }
): { errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  if (text.length > MAX_LENGTH) errors.push(`Pesan terlalu panjang (maksimal ${MAX_LENGTH} karakter).`)
  const links = text.match(/(?:https?:\/\/|www\.)\S+/gi) ?? []
  if (links.length > 1) errors.push('Gunakan paling banyak satu tautan.')
  if (links.some((l) => SHORTENERS.includes(hostOf(l)))) errors.push('Tautan pemendek (bit.ly, dll.) tidak diizinkan; pakai tautan asli.')
  const named = text.includes('{bisnis}') || (ctx.businessName.trim() !== '' && text.toLowerCase().includes(ctx.businessName.trim().toLowerCase()))
  if (!named) errors.push('Pesan harus menyebut nama bisnis agar penerima mengenali pengirim.')
  const letters = text.replace(/[^A-Za-z]/g, '')
  if (letters.length >= 10 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.4)
    warnings.push('Terlalu banyak huruf kapital; tulis dengan huruf biasa.')
  if (ctx.lastCampaignText && ctx.lastCampaignText.trim() === text.trim())
    warnings.push('Isi pesan sama persis dengan kampanye terakhir ke audiens ini.')
  return { errors, warnings }
}

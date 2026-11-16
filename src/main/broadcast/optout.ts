export const STOP_CONFIRMATION =
  'Baik, Anda tidak akan menerima pesan promosi lagi. Balas MULAI jika ingin berlangganan kembali.'
export const START_CONFIRMATION = 'Terima kasih, Anda berlangganan kembali dan akan menerima informasi dari kami.'

const MAX_LENGTH = 40
const STOP = new Set([
  'berhenti', 'stop', 'unsubscribe', 'batal langganan', 'jangan kirim lagi', 'hapus nomor saya',
  'stop dong', 'berhenti ya', 'berhenti dong', 'stop kirim', 'berhenti kirim', 'tolong berhenti', 'tolong stop'
])
const START = new Set(['mulai', 'start', 'langganan', 'mulai lagi'])
const COMPLAINT = /\b(spam|laporkan|penipu|penipuan)\b/

const normalise = (text: string): string =>
  text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim()

/**
 * Only a short message that IS the request counts: "stop" or "BERHENTI." but not "jangan stop dulu ya".
 * Complaints are matched more loosely because the safe reaction (stop sending, tell the admin) costs little.
 */
export function classifyReply(text: string): 'stop' | 'start' | 'complaint' | null {
  const t = normalise(text)
  if (!t || t.length > MAX_LENGTH) return null
  if (STOP.has(t)) return 'stop'
  if (START.has(t)) return 'start'
  if (COMPLAINT.test(t)) return 'complaint'
  return null
}

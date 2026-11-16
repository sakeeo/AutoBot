import { createHash } from 'node:crypto'

/** Digits only; a leading 0 becomes 62; anything that is not 8–15 digits is not a phone number. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (!digits) return null
  // A spreadsheet drops the leading 0 of 0812…, leaving 812…: still an Indonesian mobile number.
  const n = digits.startsWith('0') ? '62' + digits.slice(1) : /^8\d{8,11}$/.test(digits) ? '62' + digits : digits
  return n.length >= 8 && n.length <= 15 ? n : null
}

export const isLidJid = (jid: string): boolean => jid.endsWith('@lid')

/** The phone number inside a phone jid; a lid or a group has none. */
export function numberFromJid(jid: string): string | null {
  const m = /^(\d{6,20})@s\.whatsapp\.net$/.exec(jid)
  return m ? m[1] : null
}

export const hashNumber = (value: string, salt: string): string =>
  createHash('sha256').update(`${salt}:${value}`).digest('hex')

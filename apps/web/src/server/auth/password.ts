import { hash, verify } from '@node-rs/argon2'

export const MIN_PASSWORD = 12
export const MAX_PASSWORD = 200

// Argon2id with the OWASP minimum: 19 MiB of memory, 2 passes, 1 lane. The parameters travel inside each hash, so they
// can be raised later and old hashes still verify.
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const

const COMMON = new Set([
  'passwordpassword', 'password1234', 'password12345', 'password123456', 'katasandi123', 'katasandi1234', 'katasandiku123',
  'qwertyuiop12', 'qwertyuiopas', 'qwertyuiop123', 'asdfghjkl123', 'zxcvbnm12345', '123456789012', '1234567890123',
  '12345678901234', '111111111111', '000000000000', '210987654321', 'abcdefghijkl', 'abcdef123456', 'iloveyou1234',
  'autobot12345', 'autobotadmin1', 'whatsapp1234', 'whatsappbot12', 'administrator1', 'admin12345678', 'adminadmin123',
  'indonesia1234', 'indonesia2024', 'indonesia2025', 'indonesia2026', 'bismillah1234', 'bismillah123', 'sayangkamu123',
  'kerabatkoding', 'kerabatkoding1', 'welcome12345', 'letmein12345', 'changeme1234', 'passw0rd1234', 'p@ssw0rd1234'
])

const SEQUENCES = ['abcdefghijklmnopqrstuvwxyz', 'qwertyuiopasdfghjklzxcvbnm', '01234567890123456789', '98765432109876543210']

/** Why a password is not acceptable (Indonesian, shown to the person), or null when it is fine. */
export function passwordProblem(password: string, username = ''): string | null {
  if (password.length < MIN_PASSWORD) return `Password minimal ${MIN_PASSWORD} karakter.`
  if (password.length > MAX_PASSWORD) return `Password maksimal ${MAX_PASSWORD} karakter.`
  const lower = password.toLowerCase()
  if (username.length >= 3 && lower.includes(username.toLowerCase())) return 'Password tidak boleh memuat username.'
  if (COMMON.has(lower)) return 'Password terlalu umum. Pakai kalimat sandi yang lebih unik.'
  if (/^(.)\1+$/.test(password)) return 'Password tidak boleh berupa satu karakter yang diulang.'
  if (SEQUENCES.some((s) => s.includes(lower))) return 'Password tidak boleh berupa urutan huruf atau angka.'
  if (new Set(lower).size < 5) return 'Password terlalu sederhana: pakai lebih banyak karakter yang berbeda.'
  return null
}

export const hashPassword = (password: string): Promise<string> => hash(password.normalize('NFKC'), OPTIONS)

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password.normalize('NFKC'))
  } catch {
    return false
  }
}

let dummy: Promise<string> | null = null
/** Verifies against a throwaway hash, so a wrong username takes as long as a wrong password. */
export async function burnPasswordCheck(password: string): Promise<false> {
  dummy ??= hashPassword('tidak-ada-yang-memakai-ini-untuk-masuk')
  await verifyPassword(await dummy, password)
  return false
}

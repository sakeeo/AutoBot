import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { openAuthDb } from './server/auth/db'
import { resetAccount } from './server/auth/reset-account'

const dataDir = (): string => resolve(process.env.AUTH_DATA_DIR ?? '/data')

/** `backup <folder>`: a consistent copy of the account database (SQLite online backup, safe while the panel runs). */
async function backup(dest: string): Promise<void> {
  const out = resolve(dest)
  mkdirSync(out, { recursive: true, mode: 0o700 })
  const file = join(dataDir(), 'auth.db')
  if (existsSync(file)) {
    const db = new Database(file, { fileMustExist: true })
    try { await db.backup(join(out, 'auth.db')) } finally { db.close() }
  }
  console.log(`OK ${out}`)
}

/** `reset-account --yes`: deletes the owner account only; WhatsApp, knowledge and settings stay. Restart the panel after. */
function resetAccountCmd(): void {
  const file = join(dataDir(), 'auth.db')
  if (!existsSync(file)) { console.error(`auth.db tidak ditemukan di ${dataDir()}.`); process.exit(1) }
  const db = openAuthDb(file)
  try {
    const r = resetAccount(db, Date.now())
    console.log(r.hadAccount
      ? 'OK akun dihapus (username, password, authenticator, kode pemulihan, semua sesi). Data bot tidak diubah.'
      : 'OK belum ada akun; status setup dibersihkan.')
    console.log('Mulai ulang panel (web), lalu ambil token setup baru dari log untuk membuat akun lagi.')
  } finally { db.close() }
}

const [cmd, arg] = process.argv.slice(2)
if (cmd === 'backup' && arg) {
  backup(arg).catch((e) => { console.error('backup gagal:', e instanceof Error ? e.message : e); process.exit(1) })
} else if (cmd === 'reset-account') {
  if (arg !== '--yes') {
    console.error('Ini menghapus akun pemilik (username, password, authenticator, kode pemulihan). Data bot tetap.\nUlangi dengan: node cli.js reset-account --yes')
    process.exit(2)
  }
  resetAccountCmd()
} else {
  console.error('pemakaian:\n  node cli.js backup <folder>\n  node cli.js reset-account --yes')
  process.exit(2)
}

import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** `backup <folder>`: a consistent copy of the account database (SQLite online backup, safe while the panel runs). */
async function backup(dest: string): Promise<void> {
  const dir = resolve(process.env.AUTH_DATA_DIR ?? '/data')
  const out = resolve(dest)
  mkdirSync(out, { recursive: true, mode: 0o700 })
  const file = join(dir, 'auth.db')
  if (existsSync(file)) {
    const db = new Database(file, { fileMustExist: true })
    try { await db.backup(join(out, 'auth.db')) } finally { db.close() }
  }
  console.log(`OK ${out}`)
}

const [cmd, arg] = process.argv.slice(2)
if (cmd === 'backup' && arg) {
  backup(arg).catch((e) => { console.error('backup gagal:', e instanceof Error ? e.message : e); process.exit(1) })
} else {
  console.error('pemakaian: node cli.js backup <folder>')
  process.exit(2)
}

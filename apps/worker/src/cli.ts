import Database from 'better-sqlite3'
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Server-side maintenance for the worker container. `backup <folder>` writes a consistent copy of everything that
 * matters: the database (SQLite online backup, safe while the bot runs), the WhatsApp session, the knowledge files, the
 * settings and the encrypted secrets. The key that opens the secrets is NOT in the copy: keep it elsewhere.
 */
async function backup(dest: string): Promise<void> {
  const data = resolve(process.env.DATA_DIR ?? '/data')
  const out = resolve(dest)
  mkdirSync(out, { recursive: true, mode: 0o700 })
  const dbFile = join(data, 'autobot.db')
  if (existsSync(dbFile)) {
    const db = new Database(dbFile, { fileMustExist: true })
    try { await db.backup(join(out, 'autobot.db')) } finally { db.close() }
  }
  for (const name of ['sessions', 'knowledge', 'settings.json', 'secrets.json']) {
    const from = join(data, name)
    if (existsSync(from)) cpSync(from, join(out, name), { recursive: true })
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

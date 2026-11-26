// Local mode (npm run dev): deletes the owner account only. WhatsApp session, knowledge and settings stay.
//   npm run reset-account
import { spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const rl = createInterface({ input: process.stdin, output: process.stdout })
const ok = await rl.question('Ini MENGHAPUS akun pemilik (username, password, authenticator, kode pemulihan). Data bot tetap.\nHentikan "npm run dev" dulu. Ketik \'reset akun\' untuk lanjut: ')
rl.close()
if (ok.trim() !== 'reset akun') { console.log('dibatalkan'); process.exit(1) }
const build = spawnSync('node', ['build-cli.mjs'], { cwd: join(root, 'apps/web'), stdio: ['ignore', 'ignore', 'inherit'] })
if (build.status !== 0) process.exit(1)
const r = spawnSync('node', [join(root, 'apps/web/cli-dist/cli.js'), 'reset-account', '--yes'], {
  stdio: 'inherit', env: { ...process.env, AUTH_DATA_DIR: join(root, '.local-data/web') }
})
if (r.status === 0) console.log('Jalankan "npm run dev" lagi; token setup baru tercetak di terminal.')
process.exit(r.status ?? 1)

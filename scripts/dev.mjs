// Jalankan AutoBot lokal: worker (127.0.0.1:4000) + web (http://localhost:3000).
// Rahasia dibuat sekali di .local-data/ (git-ignored).
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dir = join(root, '.local-data')
mkdirSync(join(dir, 'worker'), { recursive: true })
mkdirSync(join(dir, 'web'), { recursive: true })
const envFile = join(dir, 'secrets.env')
if (!existsSync(envFile))
  writeFileSync(
    envFile,
    ['WORKER_TOKEN', 'ENGINE_SECRET_KEY', 'AUTH_SECRET_KEY'].map((k) => `${k}=${randomBytes(32).toString('hex')}`).join('\n') + '\n',
    { mode: 0o600 }
  )
const secrets = Object.fromEntries(
  readFileSync(envFile, 'utf8').split('\n').filter(Boolean).map((l) => l.split('='))
)

const built = spawnSync('node', ['build.mjs'], { cwd: join(root, 'apps/worker'), stdio: 'inherit' })
if (built.status !== 0) process.exit(1)

const base = { ...process.env, ...secrets }
const kids = [
  spawn('node', ['apps/worker/dist/main.js'], {
    cwd: root, stdio: 'inherit',
    env: { ...base, DATA_DIR: join(dir, 'worker'), HOST: '127.0.0.1', PORT: '4000' }
  }),
  spawn('npx', ['next', 'dev', '-p', '3000'], {
    cwd: join(root, 'apps/web'), stdio: 'inherit',
    env: { ...base, AUTH_DATA_DIR: join(dir, 'web'), WORKER_URL: 'http://127.0.0.1:4000', APP_URL: 'http://localhost:3000' }
  })
]
const stop = () => kids.forEach((k) => k.kill())
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
kids.forEach((k) => k.on('exit', stop))
console.log('\nAutoBot: buka http://localhost:3000. Token setup tercetak di log web di bawah.\n')

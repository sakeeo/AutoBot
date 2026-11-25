import { describe, it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig, parseSecretKey } from '../src/config'
import { makeDir } from './helpers/fixtures'

const HEX = 'ab'.repeat(32)
const TOKEN = 't'.repeat(40)

describe('loadConfig', () => {
  it('reads the key and the token and applies defaults', () => {
    const c = loadConfig({ ENGINE_SECRET_KEY: HEX, WORKER_TOKEN: TOKEN })
    expect(c).toMatchObject({ dataDir: '/data', host: '0.0.0.0', port: 4000, token: TOKEN })
    expect(c.secretKey).toHaveLength(32)
  })
  it('reads secrets from files (Docker secrets) and trims the newline', () => {
    const dir = makeDir('wa-cfg-')
    writeFileSync(join(dir, 'key'), `${HEX}\n`)
    writeFileSync(join(dir, 'token'), `${TOKEN}\n`)
    const c = loadConfig({ ENGINE_SECRET_KEY_FILE: join(dir, 'key'), WORKER_TOKEN_FILE: join(dir, 'token') })
    expect(c.token).toBe(TOKEN)
  })
  it('accepts a base64 key of 32 bytes and rejects any other length', () => {
    expect(parseSecretKey(Buffer.alloc(32, 7).toString('base64'))).toHaveLength(32)
    expect(() => parseSecretKey('pendek')).toThrow(/32 byte/)
    expect(() => parseSecretKey('ab'.repeat(16))).toThrow(/32 byte/)
  })
  it('refuses to start without a key, without a token, or with a short token', () => {
    expect(() => loadConfig({ WORKER_TOKEN: TOKEN })).toThrow(/ENGINE_SECRET_KEY/)
    expect(() => loadConfig({ ENGINE_SECRET_KEY: HEX })).toThrow(/WORKER_TOKEN/)
    expect(() => loadConfig({ ENGINE_SECRET_KEY: HEX, WORKER_TOKEN: 'pendek' })).toThrow(/32 karakter/)
  })
  it('never puts a secret into an error message', () => {
    for (const bad of [{ ENGINE_SECRET_KEY: 'rahasia-yang-salah-panjang', WORKER_TOKEN: TOKEN }, { ENGINE_SECRET_KEY: HEX, WORKER_TOKEN: 'rahasia-pendek' }]) {
      try { loadConfig(bad) } catch (e) {
        expect((e as Error).message).not.toContain('rahasia')
        expect((e as Error).message).not.toContain(HEX)
      }
    }
  })
  it('rejects an invalid port and a missing secret file', () => {
    expect(() => loadConfig({ ENGINE_SECRET_KEY: HEX, WORKER_TOKEN: TOKEN, PORT: '0' })).toThrow(/PORT/)
    expect(() => loadConfig({ ENGINE_SECRET_KEY_FILE: '/tidak/ada', WORKER_TOKEN: TOKEN })).toThrow(/tidak ada/)
  })
})

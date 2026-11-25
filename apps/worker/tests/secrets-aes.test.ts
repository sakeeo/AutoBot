import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AesGcmSecretStore } from '../src/settings'
import { makeDir } from './helpers/fixtures'

const file = () => join(makeDir('wa-sec-'), 'secrets.json')

describe('AesGcmSecretStore', () => {
  it('stores and returns a secret, and keeps the plaintext out of the file', () => {
    const f = file()
    const s = new AesGcmSecretStore(f, randomBytes(32))
    s.set('ai-key', 'sk-ant-SUPERSECRETVALUE')
    expect(s.get('ai-key')).toBe('sk-ant-SUPERSECRETVALUE')
    expect(s.has('ai-key')).toBe(true)
    expect(readFileSync(f, 'utf8')).not.toContain('SUPERSECRETVALUE')
    expect(statSync(f).mode & 0o077).toBe(0) // readable by the owner only
  })

  it('cannot be read with another key', () => {
    const f = file()
    new AesGcmSecretStore(f, randomBytes(32)).set('k', 'rahasia')
    expect(new AesGcmSecretStore(f, randomBytes(32)).get('k')).toBeNull()
  })

  it('treats a tampered value as absent instead of returning garbage', () => {
    const f = file()
    const key = randomBytes(32)
    const s = new AesGcmSecretStore(f, key)
    s.set('k', 'rahasia')
    const o = JSON.parse(readFileSync(f, 'utf8'))
    const raw = Buffer.from(o.k, 'base64')
    raw[raw.length - 1] ^= 1
    o.k = raw.toString('base64')
    writeFileSync(f, JSON.stringify(o))
    expect(s.get('k')).toBeNull()
  })

  it('does not let one entry be swapped for another (the name is authenticated)', () => {
    const f = file()
    const s = new AesGcmSecretStore(f, randomBytes(32))
    s.set('a', 'nilai-a')
    s.set('b', 'nilai-b')
    const o = JSON.parse(readFileSync(f, 'utf8'))
    writeFileSync(f, JSON.stringify({ a: o.b, b: o.a }))
    expect(s.get('a')).toBeNull()
    expect(s.get('b')).toBeNull()
  })

  it('uses a fresh nonce each time, so the same secret never looks the same twice', () => {
    const f = file()
    const s = new AesGcmSecretStore(f, randomBytes(32))
    s.set('a', 'sama')
    const first = JSON.parse(readFileSync(f, 'utf8')).a
    s.set('a', 'sama')
    expect(JSON.parse(readFileSync(f, 'utf8')).a).not.toBe(first)
  })

  it('deletes, survives a missing or corrupt file, and rejects a key of the wrong size', () => {
    const f = file()
    const s = new AesGcmSecretStore(f, randomBytes(32))
    expect(s.get('x')).toBeNull()
    s.set('x', '1'); s.delete('x')
    expect(s.has('x')).toBe(false)
    writeFileSync(f, '{not json')
    expect(s.get('x')).toBeNull()
    expect(() => new AesGcmSecretStore(f, randomBytes(16))).toThrow('SECRET_KEY_MUST_BE_32_BYTES')
    expect(existsSync(`${f}.tmp`)).toBe(false)
  })
})

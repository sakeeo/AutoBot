import { describe, it, expect } from 'vitest'
import { loadWebConfig } from '../src/server/config'

const KEY = 'ab'.repeat(32)
const TOKEN = 'w'.repeat(40)
const base = { AUTH_SECRET_KEY: KEY, WORKER_TOKEN: TOKEN }

describe('loadWebConfig', () => {
  it('reads the settings and applies the defaults (30 minutes idle, 12 hours absolute, direct access)', () => {
    const c = loadWebConfig({ ...base, APP_URL: 'http://localhost:3000' })
    expect(c).toMatchObject({ secure: false, workerUrl: 'http://worker:4000', trustedProxyHops: 0, dataDir: '/data' })
    expect(c.policy).toEqual({ ownerIdleMs: 30 * 60_000, ownerAbsoluteMs: 12 * 3_600_000 })
  })
  it('allows plain http only for this machine', () => {
    for (const ok of ['http://localhost:3000', 'http://127.0.0.1:3000', 'https://panel.contoh.id']) expect(() => loadWebConfig({ ...base, APP_URL: ok }), ok).not.toThrow()
    for (const bad of ['http://192.168.1.20:3000', 'http://panel.contoh.id', 'http://0.0.0.0:3000']) expect(() => loadWebConfig({ ...base, APP_URL: bad }), bad).toThrow(/https/)
    expect(() => loadWebConfig({ ...base, APP_URL: 'bukan url' })).toThrow(/URL/)
  })
  it('turns the Secure cookie flag on exactly when the panel is served over https', () => {
    expect(loadWebConfig({ ...base, APP_URL: 'https://panel.contoh.id' }).secure).toBe(true)
    expect(loadWebConfig({ ...base, APP_URL: 'http://localhost:3000' }).secure).toBe(false)
  })
  it('requires both secrets, a 32-byte key and a token of 32+ characters, and never echoes them', () => {
    expect(() => loadWebConfig({ WORKER_TOKEN: TOKEN })).toThrow(/AUTH_SECRET_KEY/)
    expect(() => loadWebConfig({ AUTH_SECRET_KEY: KEY })).toThrow(/WORKER_TOKEN/)
    expect(() => loadWebConfig({ ...base, AUTH_SECRET_KEY: 'rahasia-pendek' })).toThrow(/32 byte/)
    expect(() => loadWebConfig({ ...base, WORKER_TOKEN: 'pendek' })).toThrow(/32 karakter/)
    try { loadWebConfig({ ...base, AUTH_SECRET_KEY: 'rahasia-yang-bocor-sekali' }) } catch (e) { expect((e as Error).message).not.toContain('bocor') }
  })
  it('bounds the session and proxy settings', () => {
    expect(loadWebConfig({ ...base, SESSION_IDLE_MINUTES: '60', SESSION_ABSOLUTE_HOURS: '168', TRUSTED_PROXY_HOPS: '1' }).policy.ownerAbsoluteMs).toBe(168 * 3_600_000)
    for (const bad of [{ SESSION_IDLE_MINUTES: '1' }, { SESSION_ABSOLUTE_HOURS: '200' }, { TRUSTED_PROXY_HOPS: '9' }, { SESSION_IDLE_MINUTES: 'abc' }])
      expect(() => loadWebConfig({ ...base, ...bad }), JSON.stringify(bad)).toThrow()
  })
})

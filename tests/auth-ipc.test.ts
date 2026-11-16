import { describe, it, expect, vi } from 'vitest'
import { join } from 'node:path'
import { AuthStore } from '../src/main/auth/auth-store'
import { AUTH_CHANNELS, createAuthHandlers, guardHandler, lockAwareSend, redactWhenLocked } from '../src/main/auth/auth-ipc'
import { CHANNELS } from '../src/shared/channels'
import { makeDir } from './helpers/fixtures'

function setup(file = join(makeDir(), 'auth.json')) {
  const clock = { now: () => 1_000_000 }
  const auth = new AuthStore(file, clock)
  return { file, clock, auth, h: createAuthHandlers(auth) }
}

describe('createAuthHandlers', () => {
  it('starts unlocked when login is not enabled', () => {
    const { h } = setup()
    expect(h.isLocked()).toBe(false)
    expect(h.authState()).toEqual({ enabled: false, locked: false, username: null, autoLockMin: 0 })
  })

  it('setup returns the recovery code once and leaves the creator unlocked', () => {
    const { h } = setup()
    const r = h.authSetup('admin', 'rahasia-123')
    expect(r.ok).toBe(true)
    expect(r.ok && r.recoveryCode).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/)
    expect(h.authState()).toMatchObject({ enabled: true, locked: false, username: 'admin' })
    expect(JSON.stringify(h.authState())).not.toMatch(/hash|salt|recover/i)
  })

  it('rejects an invalid setup (short password, extra fields) without enabling login', () => {
    const { h } = setup()
    expect(h.authSetup('admin', 'pendek')).toEqual({ ok: false, error: 'invalid' })
    expect(h.authSetup('', 'rahasia-123')).toEqual({ ok: false, error: 'invalid' })
    expect(h.authState().enabled).toBe(false)
  })

  it('a fresh instance on the same file starts locked; wrong login stays locked, right one opens', () => {
    const first = setup()
    first.h.authSetup('admin', 'rahasia-123')
    const { h } = setup(first.file)
    expect(h.isLocked()).toBe(true)
    expect(h.authLogin('admin', 'salah-salah')).toEqual({ ok: false, error: 'bad' })
    expect(h.isLocked()).toBe(true)
    expect(h.authLogin('admin', 'rahasia-123')).toEqual({ ok: true })
    expect(h.isLocked()).toBe(false)
  })

  it('authLock locks again; it does nothing when login is off', () => {
    const off = setup()
    off.h.authLock()
    expect(off.h.isLocked()).toBe(false)
    const on = setup()
    on.h.authSetup('admin', 'rahasia-123')
    on.h.authLock()
    expect(on.h.isLocked()).toBe(true)
  })

  it('sensitive operations are refused while locked', () => {
    const { h } = setup()
    h.authSetup('admin', 'rahasia-123')
    h.authLock()
    expect(h.authChangePassword('rahasia-123', 'baru-baru-1')).toEqual({ ok: false, error: 'bad' })
    expect(h.authDisable('rahasia-123')).toEqual({ ok: false, error: 'bad' })
    expect(() => h.authSetAutoLock(5)).toThrow('LOCKED')
    expect(h.authState().enabled).toBe(true)
  })

  it('reset works while locked, hands out a new code, and still needs the new password to log in', () => {
    const { h } = setup()
    const code = (h.authSetup('admin', 'rahasia-123') as { recoveryCode: string }).recoveryCode
    h.authLock()
    const r = h.authReset(code, 'baru-baru-1')
    expect(r.ok).toBe(true)
    expect(r.recoveryCode).toBeDefined()
    expect(r.recoveryCode).not.toBe(code)
    expect(h.isLocked()).toBe(true)
    expect(h.authLogin('admin', 'baru-baru-1')).toEqual({ ok: true })
    expect(h.authReset('0000-0000-0000-0000', 'baru-baru-2')).toEqual({ ok: false, error: 'bad' })
    expect(h.authReset(code, 'pendek')).toEqual({ ok: false, error: 'invalid' })
  })

  it('change password, auto-lock and disable work while unlocked', () => {
    const { h } = setup()
    h.authSetup('admin', 'rahasia-123')
    expect(h.authChangePassword('rahasia-123', 'pendek')).toEqual({ ok: false, error: 'invalid' })
    expect(h.authChangePassword('rahasia-123', 'baru-baru-1')).toEqual({ ok: true })
    h.authSetAutoLock(10)
    expect(h.authState().autoLockMin).toBe(10)
    expect(h.authDisable('baru-baru-1')).toEqual({ ok: true })
    expect(h.authState().enabled).toBe(false)
    expect(h.isLocked()).toBe(false)
  })
})

describe('guardHandler and AUTH_CHANNELS', () => {
  it('blocks a non-auth handler while locked and does not call it', () => {
    const fn = vi.fn(() => 'secret')
    expect(() => guardHandler(() => true, false, fn)()).toThrow('LOCKED')
    expect(fn).not.toHaveBeenCalled()
  })
  it('passes through when unlocked or when the channel is an auth channel', () => {
    expect(guardHandler(() => false, false, () => 'ok')()).toBe('ok')
    expect(guardHandler(() => true, true, () => 'ok')()).toBe('ok')
  })
  it('AUTH_CHANNELS holds exactly the auth:* channels', () => {
    const auth = Object.values(CHANNELS).filter((c) => c.startsWith('auth:'))
    expect(auth.length).toBe(8)
    expect([...AUTH_CHANNELS].sort()).toEqual([...auth].sort())
    expect(AUTH_CHANNELS.has(CHANNELS.getLog)).toBe(false)
  })
})

describe('lock notifications and event gating', () => {
  it('tells the window when the lock engages, but not when login is off or already locked', () => {
    const onLocked = vi.fn()
    const auth = new AuthStore(join(makeDir(), 'auth.json'), { now: () => 1 })
    const h = createAuthHandlers(auth, onLocked)
    h.lock()
    expect(onLocked).not.toHaveBeenCalled()
    h.authSetup('admin', 'rahasia-123')
    h.authLock()
    expect(onLocked).toHaveBeenCalledTimes(1)
    h.lock()
    expect(onLocked).toHaveBeenCalledTimes(1)
  })

  it('lockAwareSend drops data events while locked and always lets the lock event through', () => {
    const raw = vi.fn()
    let locked = true
    const send = lockAwareSend(() => locked, raw)
    send(CHANNELS.evtEscalate, { text: 'rahasia' })
    send(CHANNELS.evtHandoff, { summary: 'rahasia' })
    send(CHANNELS.evtStatus, { state: 'waiting_qr', qr: 'QR' })
    expect(raw).not.toHaveBeenCalled()
    send(CHANNELS.evtAuthLocked, null)
    expect(raw).toHaveBeenCalledTimes(1)
    locked = false
    send(CHANNELS.evtEscalate, { text: 'halo' })
    expect(raw).toHaveBeenCalledTimes(2)
  })

  it('redactWhenLocked shows generic text while locked', () => {
    expect(redactWhenLocked(() => true, 'isi pesan pelanggan', 'Ada pesan baru')).toBe('Ada pesan baru')
    expect(redactWhenLocked(() => false, 'isi pesan pelanggan', 'Ada pesan baru')).toBe('isi pesan pelanggan')
  })
})

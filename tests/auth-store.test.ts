import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AuthStore } from '../src/main/auth/auth-store'
import { makeDir } from './helpers/fixtures'

function setup() {
  const file = join(makeDir(), 'auth.json')
  const clock = { t: 1_000_000, now() { return this.t } }
  return { file, clock, store: new AuthStore(file, clock) }
}

describe('AuthStore', () => {
  it('verifies the right password and rejects a wrong one; username ignores case', () => {
    const { store } = setup()
    expect(store.isEnabled()).toBe(false)
    store.setup('Admin', 'rahasia-123')
    expect(store.isEnabled()).toBe(true)
    expect(store.verify('admin', 'rahasia-123')).toBe('ok')
    expect(store.verify('admin', 'Rahasia-123')).toBe('bad')
    expect(store.verify('lain', 'rahasia-123')).toBe('bad')
  })

  it('never writes the password or recovery code in plain text', () => {
    const { store, file } = setup()
    const { recoveryCode } = store.setup('admin', 'rahasia-123')
    const raw = readFileSync(file, 'utf8')
    expect(raw).not.toContain('rahasia-123')
    expect(raw).not.toContain(recoveryCode)
    expect(raw).not.toContain(recoveryCode.replace(/-/g, ''))
    expect(recoveryCode).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/)
  })

  it('rejects short passwords and empty usernames, accepts spaces and unicode', () => {
    const { store } = setup()
    expect(() => store.setup('admin', '1234567')).toThrow('INVALID_INPUT')
    expect(() => store.setup('  ', 'rahasia-123')).toThrow('INVALID_INPUT')
    store.setup('admin', 'kata sandi é 1')
    expect(store.verify('admin', 'kata sandi é 1')).toBe('ok')
  })

  it('refuses a second setup', () => {
    const { store } = setup()
    store.setup('admin', 'rahasia-123')
    expect(() => store.setup('x', 'rahasia-456')).toThrow('ALREADY_ENABLED')
  })

  it('throttles after 5 consecutive failures for 30 seconds, even for the right password', () => {
    const { store, clock } = setup()
    store.setup('admin', 'rahasia-123')
    for (let i = 0; i < 5; i++) expect(store.verify('admin', 'salah-salah')).toBe('bad')
    expect(store.verify('admin', 'rahasia-123')).toBe('throttled')
    clock.t += 30_001
    expect(store.verify('admin', 'rahasia-123')).toBe('ok')
  })

  it('resets with the recovery code, issues a new one, and invalidates the old one', () => {
    const { store } = setup()
    const { recoveryCode } = store.setup('admin', 'rahasia-123')
    const r = store.reset(recoveryCode.toLowerCase().replace(/-/g, ''), 'baru-baru-1')
    expect(r).not.toBe('bad')
    const next = (r as { recoveryCode: string }).recoveryCode
    expect(next).not.toBe(recoveryCode)
    expect(store.verify('admin', 'baru-baru-1')).toBe('ok')
    expect(store.verify('admin', 'rahasia-123')).toBe('bad')
    expect(store.reset(recoveryCode, 'lagi-lagi-1')).toBe('bad')
  })

  it('throttles repeated wrong recovery codes', () => {
    const { store } = setup()
    store.setup('admin', 'rahasia-123')
    for (let i = 0; i < 5; i++) expect(store.reset('0000-0000-0000-0000', 'baru-baru-1')).toBe('bad')
    expect(store.reset('0000-0000-0000-0000', 'baru-baru-1')).toBe('throttled')
  })

  it('refuses a too-short new password on reset and on change', () => {
    const { store } = setup()
    const { recoveryCode } = store.setup('admin', 'rahasia-123')
    expect(() => store.reset(recoveryCode, 'pendek')).toThrow('INVALID_INPUT')
    expect(() => store.changePassword('rahasia-123', 'pendek')).toThrow('INVALID_INPUT')
    expect(store.verify('admin', 'rahasia-123')).toBe('ok')
  })

  it('changePassword needs the old password and keeps the old one when it is wrong', () => {
    const { store } = setup()
    store.setup('admin', 'rahasia-123')
    expect(store.changePassword('salah-salah', 'baru-baru-1')).toBe('bad')
    expect(store.verify('admin', 'rahasia-123')).toBe('ok')
    expect(store.changePassword('rahasia-123', 'baru-baru-1')).toBe('ok')
    expect(store.verify('admin', 'baru-baru-1')).toBe('ok')
  })

  it('disable needs the password, then removes the file', () => {
    const { store, file } = setup()
    store.setup('admin', 'rahasia-123')
    expect(store.disable('salah-salah')).toBe('bad')
    expect(store.isEnabled()).toBe(true)
    expect(store.disable('rahasia-123')).toBe('ok')
    expect(store.isEnabled()).toBe(false)
    expect(existsSync(file)).toBe(false)
  })

  it('persists across instances, including the auto-lock minutes', () => {
    const { store, file, clock } = setup()
    store.setup('admin', 'rahasia-123')
    store.setAutoLockMin(15)
    const again = new AuthStore(file, clock)
    expect(again.isEnabled()).toBe(true)
    expect(again.username()).toBe('admin')
    expect(again.autoLockMin()).toBe(15)
    expect(again.verify('admin', 'rahasia-123')).toBe('ok')
  })

  it('clamps auto-lock to 0..240 whole minutes', () => {
    const { store } = setup()
    store.setup('admin', 'rahasia-123')
    store.setAutoLockMin(999)
    expect(store.autoLockMin()).toBe(240)
    store.setAutoLockMin(-3)
    expect(store.autoLockMin()).toBe(0)
    store.setAutoLockMin(2.6)
    expect(store.autoLockMin()).toBe(3)
  })

  it('treats a corrupt file as login disabled without throwing', () => {
    const { file, clock } = setup()
    writeFileSync(file, '{not json')
    const s = new AuthStore(file, clock)
    expect(s.isEnabled()).toBe(false)
    expect(s.username()).toBeNull()
  })
})

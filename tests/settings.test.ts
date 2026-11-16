import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsStore, MemorySecretStore } from '../src/main/settings'

const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'wa-set-')), 'settings.json')

describe('SettingsStore', () => {
  it('returns defaults for a new file', () => {
    const s = new SettingsStore(tmpFile()).get()
    expect(s.threshold).toBe(0.6)
    expect(s.mode).toBe('extractive')
    expect(s.outOfContext.action).toBe('reply')
    expect(s.allowGroups).toBe(false)
    expect(s.theme).toBe('auto')
    expect(s.notifyIncoming).toBe(true)
  })

  it('keeps notifications on for a settings file saved before the option existed', () => {
    const f = tmpFile()
    writeFileSync(f, JSON.stringify({ threshold: 0.7 }))
    const s = new SettingsStore(f).get()
    expect(s.threshold).toBe(0.7)
    expect(s.notifyIncoming).toBe(true)
  })

  it('persists updates across instances', () => {
    const f = tmpFile()
    new SettingsStore(f).update({ threshold: 0.8 })
    expect(new SettingsStore(f).get().threshold).toBe(0.8)
  })
})

describe('MemorySecretStore', () => {
  it('stores, reports and deletes secrets', () => {
    const s = new MemorySecretStore()
    expect(s.has('k')).toBe(false)
    s.set('k', 'v')
    expect(s.get('k')).toBe('v')
    expect(s.has('k')).toBe(true)
    s.delete('k')
    expect(s.get('k')).toBeNull()
  })
})

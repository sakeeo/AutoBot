import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { acquireInstanceLock } from '../src/instance-lock'
import { makeDir } from './helpers/fixtures'

describe('acquireInstanceLock', () => {
  it('lets only one holder at a time and frees the lock on release', () => {
    const f = join(makeDir('wa-lock-'), 'instance.lock')
    const first = acquireInstanceLock(f)
    expect(() => acquireInstanceLock(f)).toThrow('INSTANCE_ALREADY_RUNNING')
    first.release()
    const second = acquireInstanceLock(f)
    second.release()
  })

  it('release is safe to call twice', () => {
    const lock = acquireInstanceLock(join(makeDir('wa-lock-'), 'instance.lock'))
    lock.release()
    expect(() => lock.release()).not.toThrow()
  })

  it('different folders do not block each other', () => {
    const a = acquireInstanceLock(join(makeDir('wa-lock-'), 'instance.lock'))
    const b = acquireInstanceLock(join(makeDir('wa-lock-'), 'instance.lock'))
    a.release(); b.release()
  })
})

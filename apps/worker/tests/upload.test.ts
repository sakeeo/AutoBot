import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MAX_UPLOAD_BYTES, saveUploads, uploadProblem } from '../src/knowledge/files'
import { makeDir } from './helpers/fixtures'

const f = (name: string, text = 'isi') => ({ name, data: Buffer.from(text) })

describe('saveUploads', () => {
  it('saves supported files and never overwrites an existing one', async () => {
    const dir = makeDir('wa-up-')
    writeFileSync(join(dir, 'faq.md'), 'lama')
    const r = await saveUploads([f('faq.md', 'baru'), f('harga.txt', 'Kopi Rp25.000')], dir)
    expect(r.added).toEqual(['faq (2).md', 'harga.txt'])
    expect(readFileSync(join(dir, 'faq.md'), 'utf8')).toBe('lama')
    expect(readFileSync(join(dir, 'faq (2).md'), 'utf8')).toBe('baru')
  })
  it('keeps only the base name, so a path in the name cannot leave the folder', async () => {
    const dir = makeDir('wa-up-')
    const outside = join(dir, '..', 'escaped.md')
    const r = await saveUploads([f('../escaped.md'), f('..\\..\\escaped2.md'), f('/etc/passwd.md')], dir)
    expect(r.added).toEqual(['escaped.md', 'escaped2.md', 'passwd.md'])
    expect(existsSync(outside)).toBe(false)
    expect(readdirSync(dir).sort()).toEqual(['escaped.md', 'escaped2.md', 'passwd.md'])
  })
  it('rejects secret files, unsupported formats, empty files, and nameless uploads', async () => {
    const dir = makeDir('wa-up-')
    const r = await saveUploads([f('.env'), f('kunci.pem'), f('x.exe'), f('kosong.md', ''), f('..'), f('')], dir)
    expect(r.added).toEqual([])
    expect(r.rejected).toHaveLength(6)
    expect(readdirSync(dir)).toEqual([])
  })
  it('rejects a file over 20 MB', () => {
    expect(uploadProblem('besar.pdf', MAX_UPLOAD_BYTES + 1)).toMatch(/20 MB/)
    expect(uploadProblem('pas.pdf', MAX_UPLOAD_BYTES)).toBeNull()
  })
  it('strips control characters from the name', async () => {
    const dir = makeDir('wa-up-')
    const r = await saveUploads([f('a\u0000b\nc.md')], dir)
    expect(r.added).toEqual(['abc.md'])
  })
})

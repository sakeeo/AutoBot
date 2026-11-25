import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { importFiles, resolveKnownFile, deleteKnownFile, uniqueName } from '../src/knowledge/files'

let root: string
let kb: string
let src: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kbfiles-'))
  kb = join(root, 'knowledge'); src = join(root, 'src')
  mkdirSync(kb); mkdirSync(src)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('uniqueName', () => {
  it('keeps a free name and numbers a taken one', () => {
    writeFileSync(join(kb, 'faq.md'), 'x')
    expect(uniqueName(kb, 'baru.md')).toBe('baru.md')
    expect(uniqueName(kb, 'faq.md')).toBe('faq (2).md')
    writeFileSync(join(kb, 'faq (2).md'), 'x')
    expect(uniqueName(kb, 'faq.md')).toBe('faq (3).md')
  })
})

describe('importFiles', () => {
  it('copies supported files into the folder without overwriting', async () => {
    writeFileSync(join(src, 'faq.md'), 'baru'); writeFileSync(join(kb, 'faq.md'), 'lama')
    const r = await importFiles([join(src, 'faq.md')], kb)
    expect(r.added).toEqual(['faq (2).md'])
    expect(readFileSync(join(kb, 'faq.md'), 'utf8')).toBe('lama')
    expect(readFileSync(join(kb, 'faq (2).md'), 'utf8')).toBe('baru')
  })
  it('rejects unsupported and secret files', async () => {
    for (const n of ['a.exe', '.env', 'k.key', 'c.pem']) writeFileSync(join(src, n), 'x')
    const r = await importFiles(['a.exe', '.env', 'k.key', 'c.pem'].map((n) => join(src, n)), kb)
    expect(r.added).toEqual([])
    expect(r.rejected.map((x) => x.name)).toEqual(['a.exe', '.env', 'k.key', 'c.pem'])
  })
})

describe('resolveKnownFile / deleteKnownFile', () => {
  const store = (files: string[]) => ({ listFiles: () => files.map((file) => ({ file })), removeFile: (_f: string) => undefined })
  it('only accepts files that are indexed and inside a knowledge folder', () => {
    const f = join(kb, 'faq.md'); writeFileSync(f, 'x')
    expect(resolveKnownFile(f, [kb], store([f]))).toBe(f)
    expect(() => resolveKnownFile(f, [kb], store([]))).toThrow()
    const outside = join(src, 'x.md'); writeFileSync(outside, 'x')
    expect(() => resolveKnownFile(outside, [kb], store([outside]))).toThrow()
    expect(() => resolveKnownFile(join(kb, '..', 'src', 'x.md'), [kb], store([join(kb, '..', 'src', 'x.md')]))).toThrow()
  })
  it('deletes the file from disk and the index', async () => {
    const f = join(kb, 'faq.md'); writeFileSync(f, 'x')
    const removed: string[] = []
    await deleteKnownFile(f, [kb], { listFiles: () => [{ file: f }], removeFile: (x) => void removed.push(x) })
    expect(existsSync(f)).toBe(false)
    expect(removed).toEqual([f])
  })
})

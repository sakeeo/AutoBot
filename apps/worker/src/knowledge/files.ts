import { copyFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, extname, join, relative, resolve, isAbsolute } from 'node:path'
import { UserError } from '../errors'
import { SUPPORTED_EXTENSIONS } from './loaders'

const MAX_BYTES = 20 * 1024 * 1024
const SECRET = (name: string): boolean => /^\.env(\..*)?$/i.test(name) || /\.(key|pem)$/i.test(name)

export interface KnownFiles {
  listFiles(): { file: string }[]
  removeFile(file: string): void
}

/** A name that does not collide with an existing file: "faq.md" -> "faq (2).md". */
export function uniqueName(dir: string, name: string): string {
  if (!existsSync(join(dir, name))) return name
  const ext = extname(name)
  const base = name.slice(0, name.length - ext.length)
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})${ext}`
    if (!existsSync(join(dir, candidate))) return candidate
  }
}

const inside = (root: string, file: string): boolean => {
  const rel = relative(resolve(root), resolve(file))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/** Copies chosen files into a knowledge folder (never overwriting); the folder watcher then indexes them. */
export async function importFiles(
  sources: string[], folder: string
): Promise<{ added: string[]; rejected: { name: string; reason: string }[] }> {
  const added: string[] = []
  const rejected: { name: string; reason: string }[] = []
  for (const s of sources) {
    const name = basename(s)
    if (SECRET(name)) { rejected.push({ name, reason: 'File rahasia tidak boleh dijadikan pengetahuan.' }); continue }
    if (!(SUPPORTED_EXTENSIONS as readonly string[]).includes(extname(name).toLowerCase())) {
      rejected.push({ name, reason: 'Format tidak didukung.' }); continue
    }
    try {
      if ((await stat(s)).size > MAX_BYTES) { rejected.push({ name, reason: 'Ukuran lebih dari 20 MB.' }); continue }
      const target = uniqueName(folder, name)
      await copyFile(s, join(folder, target))
      added.push(target)
    } catch {
      rejected.push({ name, reason: 'File tidak bisa disalin.' })
    }
  }
  return { added, rejected }
}

/** Only a file that is indexed and lives inside a configured knowledge folder may be downloaded or deleted. */
export function resolveKnownFile(file: string, folders: string[], store: KnownFiles): string {
  if (!store.listFiles().some((f) => f.file === file) || !folders.some((root) => inside(root, file)))
    throw new UserError('File tidak ditemukan.', 'NOT_FOUND')
  return file
}

export async function deleteKnownFile(file: string, folders: string[], store: KnownFiles): Promise<void> {
  const f = resolveKnownFile(file, folders, store)
  await rm(f, { force: true })
  store.removeFile(f)
}

export const MAX_UPLOAD_BYTES = MAX_BYTES

/** Why a name or size is not acceptable as knowledge, or null when it is fine. */
export function uploadProblem(name: string, size: number): string | null {
  if (SECRET(name)) return 'File rahasia tidak boleh dijadikan pengetahuan.'
  if (!(SUPPORTED_EXTENSIONS as readonly string[]).includes(extname(name).toLowerCase())) return 'Format tidak didukung.'
  if (size > MAX_BYTES) return 'Ukuran lebih dari 20 MB.'
  if (size === 0) return 'File kosong.'
  return null
}

/**
 * Saves uploaded bytes into the knowledge folder under a safe name (never overwriting). Only the base name of what the
 * browser sent is used, so a name like "../../etc/x.md" cannot leave the folder.
 */
export async function saveUploads(
  files: { name: string; data: Buffer }[], folder: string
): Promise<{ added: string[]; rejected: { name: string; reason: string }[] }> {
  const added: string[] = []
  const rejected: { name: string; reason: string }[] = []
  for (const f of files) {
    const name = basename(f.name.replace(/\\/g, '/')).replace(/[\u0000-\u001f]/g, '').trim()
    const problem = !name || name === '.' || name === '..' ? 'Nama file tidak valid.' : uploadProblem(name, f.data.length)
    if (problem) { rejected.push({ name: name || '(tanpa nama)', reason: problem }); continue }
    try {
      const target = uniqueName(folder, name)
      await writeFile(join(folder, target), f.data, { flag: 'wx' })
      added.push(target)
    } catch {
      rejected.push({ name, reason: 'File tidak bisa disimpan.' })
    }
  }
  return { added, rejected }
}

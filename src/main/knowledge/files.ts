import { copyFile, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, extname, join, relative, resolve, isAbsolute } from 'node:path'
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
    throw new Error('FILE_NOT_FOUND')
  return file
}

export async function deleteKnownFile(file: string, folders: string[], store: KnownFiles): Promise<void> {
  const f = resolveKnownFile(file, folders, store)
  await rm(f, { force: true })
  store.removeFile(f)
}

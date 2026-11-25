import { failure, reply, requireOwner, route } from '../http'

const MAX_FILES = 10
const MAX_FILE = 20 * 1024 * 1024
const MAX_REQUEST = 25 * 1024 * 1024 // a little more than one full file: multipart framing, and the hard stop for the rest

/** Uploads knowledge files (the owner only). Each one is size-checked here and again by the worker. */
export const upload = route({}, async ({ rt, req }) => {
  const g = requireOwner(rt, req)
  if (!g.ok) return g.res
  const declared = Number(req.headers.get('content-length'))
  if (!Number.isFinite(declared) || declared <= 0) return failure(rt, { ok: false, code: 'VALIDATION', message: 'Ukuran unggahan tidak diketahui.' })
  if (declared > MAX_REQUEST) return reply(rt, { status: 413, body: { ok: false, code: 'TOO_LARGE', message: 'Unggahan lebih dari 20 MB.' } })
  let form: FormData
  try { form = await req.formData() } catch { return failure(rt, { ok: false, code: 'VALIDATION', message: 'Unggahan tidak valid.' }) }
  const files = form.getAll('files').filter((f): f is File => typeof f !== 'string')
  if (files.length === 0) return failure(rt, { ok: false, code: 'VALIDATION', message: 'Pilih minimal satu berkas.' })
  if (files.length > MAX_FILES) return failure(rt, { ok: false, code: 'VALIDATION', message: `Maksimal ${MAX_FILES} berkas sekali unggah.` })
  const added: string[] = []
  const rejected: { name: string; reason: string }[] = []
  for (const f of files) {
    if (f.size > MAX_FILE) { rejected.push({ name: f.name, reason: 'Ukuran lebih dari 20 MB.' }); continue }
    const r = await rt.worker.upload(f.name, new Uint8Array(await f.arrayBuffer()))
    if (!r.ok) { rejected.push({ name: f.name, reason: r.message }); continue }
    const d = r.data as { added: string[]; rejected: { name: string; reason: string }[] }
    added.push(...d.added)
    rejected.push(...d.rejected)
  }
  return reply(rt, { body: { ok: true, added, rejected } })
})

/** Streams one knowledge file back as an attachment. */
export const download = route({}, async ({ rt, req }) => {
  const g = requireOwner(rt, req)
  if (!g.ok) return g.res
  const name = new URL(req.url).searchParams.get('name') ?? ''
  if (!name || name.length > 1024) return failure(rt, { ok: false, code: 'NOT_FOUND', message: 'File tidak ditemukan.' })
  const up = await rt.worker.download(name).catch(() => null)
  if (!up || !up.ok || !up.body) return failure(rt, { ok: false, code: 'NOT_FOUND', message: 'File tidak ditemukan.' })
  return new Response(up.body, {
    headers: {
      'content-type': 'application/octet-stream',
      'content-disposition': up.headers.get('content-disposition') ?? 'attachment',
      'x-content-type-options': 'nosniff', 'cache-control': 'no-store',
      ...(up.headers.get('content-length') ? { 'content-length': up.headers.get('content-length') as string } : {})
    }
  })
})

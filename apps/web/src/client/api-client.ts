import type { Api } from '@autobot/contracts/ipc'
import { CHANNELS as C } from '@autobot/contracts/channels'

/** What the browser adds on top of the contract: uploading and downloading files need the browser itself. */
export interface WebApi extends Api {
  uploadKnowledge(files: File[]): Promise<{ added: string[]; rejected: { name: string; reason: string }[] }>
  knowledgeDownloadUrl(name: string): string
}

export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) { super(message) }
}

export const SESSION_EXPIRED_EVENT = 'autobot:session-expired'

type AskPassword = () => Promise<string | null>
let askPassword: AskPassword | null = null
/** The shell registers a dialog here; a risky action then asks for the password and carries on. */
export function registerPasswordPrompt(fn: AskPassword | null): void { askPassword = fn }

export async function postJson(path: string, body: unknown): Promise<{ res: Response; data: any }> {
  const res = await fetch(path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
    credentials: 'same-origin', cache: 'no-store'
  })
  let data: any = null
  try { data = await res.json() } catch { /* not JSON: handled by the caller through the status */ }
  return { res, data }
}

export async function callRpc(method: string, args: unknown[]): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const { res, data } = await postJson(`/api/rpc/${method}`, { args })
    if (res.ok && data?.ok) return data.data
    if (data?.code === 'STEP_UP_REQUIRED' && attempt === 0 && askPassword) {
      const password = await askPassword()
      if (password === null) throw new ApiError('CANCELLED', 'Dibatalkan.', 0)
      const again = await postJson('/api/auth/reauth', { password })
      if (!again.res.ok) throw new ApiError(again.data?.code ?? 'BAD_CREDENTIALS', again.data?.message ?? 'Password salah.', again.res.status)
      continue
    }
    if (res.status === 401 && data?.code === 'SESSION_EXPIRED' && typeof window !== 'undefined') window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
    throw new ApiError(data?.code ?? 'UPSTREAM', data?.message ?? 'Permintaan gagal.', res.status)
  }
}

// ---- live events: one connection shared by every subscriber ---------------------------------------------------------

const listeners = new Map<string, Set<(payload: any) => void>>()
let source: EventSource | null = null
let retry: ReturnType<typeof setTimeout> | null = null

function open(): void {
  if (source || typeof EventSource === 'undefined' || listeners.size === 0) return
  const es = new EventSource('/api/events')
  source = es
  for (const name of [C.evtStatus, C.evtMessage, C.evtIndexStatus, C.evtEscalate, C.evtHandoff, C.evtKnowledgeSync]) {
    es.addEventListener(name, (e) => {
      let payload: unknown = null
      try { payload = JSON.parse((e as MessageEvent).data) } catch { return }
      for (const cb of listeners.get(name) ?? []) cb(payload)
    })
  }
  es.onerror = () => {
    // A network drop is retried by the browser itself. A refusal (signed out) closes the stream for good: look why.
    if (es.readyState !== EventSource.CLOSED) return
    source = null
    fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' }).then((r) => {
      if (r.status === 401) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
      else retry = setTimeout(open, 3000)
    }).catch(() => { retry = setTimeout(open, 3000) })
  }
}

export function subscribe(channel: string, cb: (payload: any) => void): () => void {
  let set = listeners.get(channel)
  if (!set) listeners.set(channel, (set = new Set()))
  set.add(cb)
  open()
  return () => {
    set!.delete(cb)
    if (set!.size === 0) listeners.delete(channel)
    if (listeners.size === 0) {
      if (retry) clearTimeout(retry)
      source?.close()
      source = null
    }
  }
}

// ---- the api object -------------------------------------------------------------------------------------------------

export function createApi(): WebApi {
  const api: Record<string, unknown> = {}
  for (const method of Object.keys(C).filter((k) => !k.startsWith('evt'))) api[method] = (...args: unknown[]) => callRpc(method, args)
  api.onStatus = (cb: (p: unknown) => void) => subscribe(C.evtStatus, cb)
  api.onMessage = (cb: (p: unknown) => void) => subscribe(C.evtMessage, cb)
  api.onIndexStatus = (cb: (p: unknown) => void) => subscribe(C.evtIndexStatus, cb)
  api.onEscalate = (cb: (p: unknown) => void) => subscribe(C.evtEscalate, cb)
  api.onHandoff = (cb: (p: unknown) => void) => subscribe(C.evtHandoff, cb)
  api.onKnowledgeSync = (cb: (p: unknown) => void) => subscribe(C.evtKnowledgeSync, cb)
  api.uploadKnowledge = async (files: File[]) => {
    const form = new FormData()
    for (const f of files) form.append('files', f)
    const res = await fetch('/api/knowledge/upload', { method: 'POST', body: form, credentials: 'same-origin' })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.ok) throw new ApiError(data?.code ?? 'UPSTREAM', data?.message ?? 'File tidak bisa diunggah.', res.status)
    return { added: data.added as string[], rejected: data.rejected as { name: string; reason: string }[] }
  }
  api.knowledgeDownloadUrl = (name: string) => `/api/knowledge/download?name=${encodeURIComponent(name)}`
  return api as unknown as WebApi
}

/** Puts the api where the pages look for it. Runs in the browser only. */
export function installApi(): void {
  if (typeof window === 'undefined') return
  if (!(window as unknown as { api?: unknown }).api) (window as unknown as { api: WebApi }).api = createApi()
}

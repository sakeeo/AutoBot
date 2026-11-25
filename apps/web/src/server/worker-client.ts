import type { WorkerPort } from './auth/types'

export interface WorkerCallError { status: number; code: string; message: string }
export type RpcResult = { ok: true; data: unknown } | ({ ok: false } & WorkerCallError & { issues?: unknown })

/** Everything the web app does with the worker, so route handlers and tests depend on this shape and not on HTTP. */
export interface WebWorker extends WorkerPort {
  rpc(method: string, args: unknown[]): Promise<RpcResult>
  upload(name: string, data: Uint8Array): Promise<RpcResult>
  download(name: string): Promise<Response>
  events(signal: AbortSignal): Promise<Response>
  health(): Promise<WorkerHealth | null>
}

/** Speaks to the worker over the private network with the shared token. */
export interface WorkerHealth {
  ok: boolean
  wa: string
  botEnabled: boolean
  clock?: { status: 'ok' | 'warn' | 'bad' | 'unknown'; skewMs: number | null; checkedAt: number | null }
}

export class HttpWorker implements WebWorker {
  constructor(private base: string, private token: string, private fetchImpl: typeof fetch = fetch) {}

  private req(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
    const { timeoutMs, ...rest } = init
    return this.fetchImpl(`${this.base}${path}`, {
      ...rest,
      headers: { 'x-worker-token': this.token, ...(rest.headers as Record<string, string> | undefined) },
      signal: rest.signal ?? AbortSignal.timeout(timeoutMs ?? 20_000),
      redirect: 'error'
    })
  }

  private async asResult(res: Response): Promise<RpcResult> {
    try {
      const body = (await res.json()) as { ok?: boolean; data?: unknown; code?: string; message?: string; issues?: unknown }
      if (res.ok && body.ok) return { ok: true, data: body.data }
      return { ok: false, status: res.status, code: body.code ?? 'UPSTREAM', message: body.message ?? 'Server tidak merespons dengan benar.', issues: body.issues }
    } catch {
      return { ok: false, status: 502, code: 'UPSTREAM', message: 'Server tidak merespons dengan benar.' }
    }
  }

  async rpc(method: string, args: unknown[]): Promise<RpcResult> {
    try {
      return await this.asResult(await this.req(`/rpc/${encodeURIComponent(method)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ args })
      }))
    } catch {
      return { ok: false, status: 502, code: 'UPSTREAM', message: 'Worker tidak bisa dihubungi.' }
    }
  }

  async upload(name: string, data: Uint8Array): Promise<RpcResult> {
    try {
      return await this.asResult(await this.req(`/knowledge/files?name=${encodeURIComponent(name)}`, { method: 'PUT', body: data as BodyInit, timeoutMs: 60_000 }))
    } catch {
      return { ok: false, status: 502, code: 'UPSTREAM', message: 'Worker tidak bisa dihubungi.' }
    }
  }

  download(name: string): Promise<Response> {
    return this.req(`/knowledge/download?name=${encodeURIComponent(name)}`, { timeoutMs: 60_000 })
  }

  events(signal: AbortSignal): Promise<Response> {
    return this.req('/events', { signal })
  }

  async selfNumber(): Promise<string | null> {
    const r = await this.rpc('getSelfNumber', [])
    if (!r.ok) throw new Error('worker')
    return typeof r.data === 'string' ? r.data : null
  }

  async systemSend(req: { to: string; kind: string; code?: string; username?: string; last4?: string }): Promise<{ ok: true } | { ok: false; code: string }> {
    try {
      const res = await this.req('/system-send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) })
      const body = (await res.json()) as { ok?: boolean; code?: string }
      return body.ok ? { ok: true } : { ok: false, code: body.code ?? 'WA_DISCONNECTED' }
    } catch {
      return { ok: false, code: 'WA_DISCONNECTED' }
    }
  }

  async health(): Promise<WorkerHealth | null> {
    try {
      const res = await this.req('/health', { timeoutMs: 3000 })
      return res.ok ? ((await res.json()) as WorkerHealth) : null
    } catch {
      return null
    }
  }
}

import { createPrivateKey, createSign } from 'node:crypto'
import { GsFailure } from './errors'

/** Read-only access to spreadsheets. */
export const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly'
/** Pinned: the `token_uri` inside an uploaded key file is ignored, so a doctored file cannot send the key elsewhere. */
export const TOKEN_URL = 'https://oauth2.googleapis.com/token'

export interface ServiceAccountKey { client_email: string; private_key: string }
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

const b64url = (b: Buffer | string): string => Buffer.from(b).toString('base64url')

/** Checks an uploaded key file and keeps only the two fields that are needed. */
export function parseServiceAccount(json: string): ServiceAccountKey | 'INVALID_JSON' | 'NOT_SERVICE_ACCOUNT' {
  let o: unknown
  try { o = JSON.parse(json) } catch { return 'INVALID_JSON' }
  if (!o || typeof o !== 'object') return 'INVALID_JSON'
  const r = o as Record<string, unknown>
  if (r.type !== 'service_account' || typeof r.client_email !== 'string' || typeof r.private_key !== 'string') return 'NOT_SERVICE_ACCOUNT'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.client_email)) return 'NOT_SERVICE_ACCOUNT'
  try { createPrivateKey(r.private_key) } catch { return 'NOT_SERVICE_ACCOUNT' }
  return { client_email: r.client_email, private_key: r.private_key }
}

/** Exchanges the service account key for a short-lived access token (JWT bearer flow) and caches it. */
export class GoogleAuth {
  private cached: { token: string; exp: number } | null = null
  constructor(
    private key: () => ServiceAccountKey | null,
    private fetchFn: FetchFn = fetch,
    private now: () => number = Date.now
  ) {}

  forget(): void { this.cached = null }

  async token(): Promise<string> {
    const sa = this.key()
    if (!sa) throw new GsFailure('NO_CREDENTIAL')
    if (this.cached && this.cached.exp - 60_000 > this.now()) return this.cached.token
    const iat = Math.floor(this.now() / 1000)
    const claims = { iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 }
    let assertion: string
    try {
      const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}`
      assertion = `${unsigned}.${b64url(createSign('RSA-SHA256').update(unsigned).sign(sa.private_key))}`
    } catch { throw new GsFailure('CREDENTIAL_INVALID') }
    let res: Response
    try {
      res = await this.fetchFn(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
        signal: AbortSignal.timeout(20_000)
      })
    } catch { throw new GsFailure('UPSTREAM') }
    if (res.status === 400 || res.status === 401) throw new GsFailure('CREDENTIAL_INVALID')
    if (res.status === 429) throw new GsFailure('RATE_LIMIT')
    if (!res.ok) throw new GsFailure('UPSTREAM')
    const body = (await res.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown } | null
    if (!body || typeof body.access_token !== 'string') throw new GsFailure('UPSTREAM')
    const ttl = typeof body.expires_in === 'number' ? body.expires_in : 3600
    this.cached = { token: body.access_token, exp: this.now() + ttl * 1000 }
    return body.access_token
  }
}

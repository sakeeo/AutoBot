import { NextResponse, type NextRequest } from 'next/server'

/**
 * Runs before every page. It gives each page a fresh nonce and a Content-Security-Policy that allows only scripts carrying
 * that nonce, and adds the usual defensive headers. It does NOT decide who may see a page: that check is made by the page
 * and by every API route themselves, so a gap here cannot expose anything.
 */
export function proxy(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const dev = process.env.NODE_ENV === 'development'
  const https = (process.env.APP_URL ?? '').startsWith('https://')
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'", // style="" attributes set by React (progress bars, widths); no inline <style> or script
    "img-src 'self' data: blob:", // QR codes are drawn as data: images
    "font-src 'self' data:",
    `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ['upgrade-insecure-requests'] : [])
  ].join('; ')

  const headers = new Headers(request.headers)
  headers.set('x-nonce', nonce)
  headers.set('content-security-policy', csp)
  const res = NextResponse.next({ request: { headers } })
  res.headers.set('content-security-policy', csp)
  res.headers.set('x-content-type-options', 'nosniff')
  res.headers.set('x-frame-options', 'DENY')
  res.headers.set('referrer-policy', 'no-referrer')
  res.headers.set('cross-origin-opener-policy', 'same-origin')
  res.headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()')
  res.headers.set('cache-control', 'no-store')
  if (https) res.headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains')
  return res
}

export const config = {
  // pages only: API routes set their own headers, and static files need no policy
  matcher: [{ source: '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|jpg|jpeg|gif|webp|ico|woff2?)$).*)' }]
}

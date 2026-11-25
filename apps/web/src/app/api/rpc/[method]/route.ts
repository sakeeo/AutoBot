import { rpc } from '../../../../server/handlers/rpc'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
/** The method name is the last path segment: /api/rpc/getSettings */
export const POST = rpc((req) => decodeURIComponent(new URL(req.url).pathname.split('/').pop() ?? ''))

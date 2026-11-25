import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { AppShell } from '../../client/shell/AppShell'
import { cookieName } from '../../server/http'
import { getRuntime } from '../../server/runtime'

// every page behind the login reads the session, so none of them may be built ahead of time
export const dynamic = 'force-dynamic'

/**
 * The gate for every page of the panel. It does not trust the proxy or the browser: the session is checked here, on the
 * server, for each request. No account yet means the setup wizard; no (or an expired) session means the login page.
 */
export default async function PanelLayout({ children }: { children: ReactNode }) {
  const rt = getRuntime()
  if (!rt.sys.setup.isComplete()) redirect('/setup')
  const jar = await cookies()
  const session = rt.sys.auth.owner(jar.get(cookieName(rt, 'sid'))?.value)
  if (!session) redirect('/login')
  if (session.restricted) redirect('/login/authenticator')
  return <AppShell username={rt.sys.auth.user()?.username ?? ''}>{children}</AppShell>
}

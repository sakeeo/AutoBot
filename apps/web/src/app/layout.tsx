import { headers } from 'next/headers'
import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import Script from 'next/script'
import 'bootstrap/dist/css/bootstrap.min.css'
import 'bootstrap-icons/font/bootstrap-icons.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '../client/styles/tokens.css'
import '../client/styles/shell.css'
import '../client/styles/ui.css'
import '../client/styles/forms.css'
import '../client/styles/chat.css'

export const metadata: Metadata = {
  title: 'AutoBot — Balas WA Otomatis pakai AI',
  icons: { icon: '/icon.svg' },
  robots: { index: false, follow: false }
}
export const viewport: Viewport = { width: 'device-width', initialScale: 1 }

// Runs before the first paint so the chosen colour mode is already in place (no flash of the wrong theme).
const THEME_SCRIPT = `try{var t=localStorage.getItem('wa-theme');var d=t==='dark'||((t===null||t==='auto')&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.bsTheme=d?'dark':'light'}catch(e){}`

export default async function RootLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined
  return (
    <html lang="id" data-bs-theme="light" suppressHydrationWarning>
      <body>
        {/* next/script places this before React starts: it runs once, and React never renders a <script> itself */}
        <Script id="theme-init" strategy="beforeInteractive" nonce={nonce}>{THEME_SCRIPT}</Script>
        {children}
      </body>
    </html>
  )
}

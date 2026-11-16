import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = { '@shared': resolve('src/shared') }

/** The strict CSP in index.html would block Vite's inline HMR preamble, so drop it in dev only. */
const devWithoutCsp = {
  name: 'dev-without-csp',
  apply: 'serve' as const,
  transformIndexHtml: (html: string) =>
    html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
}

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], resolve: { alias: shared } },
  preload: { plugins: [externalizeDepsPlugin()], resolve: { alias: shared } },
  renderer: { root: 'src/renderer', plugins: [react(), devWithoutCsp], resolve: { alias: shared } }
})

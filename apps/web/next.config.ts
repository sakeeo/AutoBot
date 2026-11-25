import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'

const here = dirname(fileURLToPath(import.meta.url))

const config: NextConfig = {
  output: 'standalone',
  // native modules are loaded by Node itself, not bundled
  serverExternalPackages: ['better-sqlite3', '@node-rs/argon2'],
  // the shared contract is TypeScript source in this repo
  transpilePackages: ['@autobot/contracts'],
  // trace dependencies from the repository root, so the workspace packages land in the standalone output
  outputFileTracingRoot: join(here, '../../'),
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    // with a proxy, Next buffers request bodies up to this size and silently cuts anything longer: keep it above the
    // largest upload (20 MB file plus multipart framing) so a document is never stored truncated
    proxyClientMaxBodySize: '26mb'
  }
}

export default config

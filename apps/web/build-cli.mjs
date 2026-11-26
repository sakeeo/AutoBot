// Bundles the maintenance CLI (backup, reset-account) into one file. better-sqlite3 stays external: the image already carries it.
import { build } from 'esbuild'

await build({
  entryPoints: ['src/cli.ts'], outfile: 'cli-dist/cli.js', bundle: true, platform: 'node', target: 'node22', format: 'cjs',
  external: ['better-sqlite3'], logLevel: 'info'
})

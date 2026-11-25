// Bundles the worker (and the shared contracts) into one CommonJS file. Third-party packages stay external: the
// image installs them with npm, which also fetches the native build of better-sqlite3 for its platform.
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const external = Object.keys(pkg.dependencies).filter((d) => !d.startsWith('@autobot/'))

await build({
  entryPoints: { main: 'src/main.ts', cli: 'src/cli.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  external,
  logLevel: 'info'
})

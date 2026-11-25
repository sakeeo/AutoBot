import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openAuthDb } from './auth/db'
import { createAuthSystem, type AuthSystem } from './auth'
import { loadWebConfig, type WebConfig } from './config'
import { HttpWorker, type WebWorker } from './worker-client'

export interface Runtime {
  config: WebConfig
  sys: AuthSystem
  worker: WebWorker
}

const KEY = '__autobotWebRuntime'
type Holder = typeof globalThis & { [KEY]?: Runtime }

/**
 * The one runtime of this process. It lives on globalThis because Next can load a module more than once (the server
 * start hook and the route handlers may be bundled separately, and dev reloads modules), and two copies would mean
 * two database connections and two setup tokens.
 */
export function getRuntime(): Runtime {
  const g = globalThis as Holder
  if (!g[KEY]) {
    const config = loadWebConfig()
    mkdirSync(config.dataDir, { recursive: true, mode: 0o700 })
    const worker = new HttpWorker(config.workerUrl, config.workerToken)
    const db = openAuthDb(join(config.dataDir, 'auth.db'))
    g[KEY] = { config, worker, sys: createAuthSystem({ db, secretKey: config.authSecret, worker, policy: config.policy }) }
  }
  return g[KEY]
}

/** Tests install their own runtime (in-memory database, fake worker). */
export function setRuntimeForTests(rt: Runtime | undefined): void {
  ;(globalThis as Holder)[KEY] = rt
}

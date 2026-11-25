import type { Db } from './db'

/** Small key/value flags that belong to this installation rather than to the settings file. */
export class InstanceMeta {
  constructor(private db: Db) {}

  get(key: string): string | null {
    const r = this.db.prepare('SELECT v FROM instance_meta WHERE k = ?').get(key) as { v: string } | undefined
    return r?.v ?? null
  }

  set(key: string, value: string): void {
    this.db.prepare('INSERT INTO instance_meta(k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(key, value)
  }

  /** The bot answers customers only while this is on. It is off until the owner switches it on. */
  botEnabled(): boolean {
    return this.get('bot_enabled') === '1'
  }

  setBotEnabled(on: boolean): void {
    this.set('bot_enabled', on ? '1' : '0')
  }
}

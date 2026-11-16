import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Settings } from '../shared/types'

type Value = [Settings | null, (patch: Partial<Settings>) => Promise<void>]

/** Loads settings once and exposes a patch function that saves through IPC. */
function useLoadedSettings(enabled: boolean): Value {
  const [settings, setSettings] = useState<Settings | null>(null)
  useEffect(() => {
    if (!enabled) return
    let live = true
    window.api.getSettings().then((s) => live && setSettings(s))
    return () => { live = false }
  }, [enabled])
  const patch = useCallback(async (p: Partial<Settings>) => {
    setSettings(await window.api.updateSettings(p))
  }, [])
  return [settings, patch]
}

const Ctx = createContext<Value | null>(null)

/** One shared copy for the whole subtree, so a change made on one page is seen by every other consumer. */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const value = useLoadedSettings(true)
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Uses the shared copy when there is a provider; otherwise its own (a page rendered on its own). */
export function useSettings(): Value {
  const shared = useContext(Ctx)
  const own = useLoadedSettings(shared === null)
  return shared ?? own
}

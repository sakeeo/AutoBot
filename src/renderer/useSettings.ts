import { useCallback, useEffect, useState } from 'react'
import type { Settings } from '../shared/types'

/** Loads settings once and exposes a patch function that saves through IPC. */
export function useSettings(): [Settings | null, (patch: Partial<Settings>) => Promise<void>] {
  const [settings, setSettings] = useState<Settings | null>(null)
  useEffect(() => {
    let live = true
    window.api.getSettings().then((s) => live && setSettings(s))
    return () => { live = false }
  }, [])
  const patch = useCallback(async (p: Partial<Settings>) => {
    setSettings(await window.api.updateSettings(p))
  }, [])
  return [settings, patch]
}

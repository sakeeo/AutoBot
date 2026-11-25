import { useCallback, useEffect, useRef, useState } from 'react'
import { validateProfile, type BrandProfile, type Issue } from '@autobot/contracts/brand'

const SAVE_DELAY_MS = 400

/** Draft editing with debounced saving; validation runs locally so errors show immediately. */
export function useBrand() {
  const [draft, setDraft] = useState<BrandProfile | null>(null)
  const [botNumber, setBotNumber] = useState<string | null>(null)
  const [productCount, setProductCount] = useState(0)
  const [serverIssues, setServerIssues] = useState<Issue[]>([])
  const [dirty, setDirty] = useState(false)
  const latest = useRef<BrandProfile | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    const snap = await window.api.getBrand()
    latest.current = snap.draft
    setDraft(snap.draft)
    setBotNumber(snap.botNumber)
    setProductCount(snap.productCount)
    setServerIssues([])
    setDirty(false)
  }, [])

  useEffect(() => {
    load()
    return () => {
      // Leaving the page must not drop an edit that is still waiting for the debounce.
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
        if (latest.current) void window.api.saveBrandDraft(latest.current)
      }
    }
  }, [load])

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    if (!latest.current) return
    await window.api.saveBrandDraft(latest.current)
  }, [])

  const update = useCallback((fn: (d: BrandProfile) => BrandProfile) => {
    if (!latest.current) return
    const next = fn(structuredClone(latest.current))
    latest.current = next
    setDraft(next)
    setDirty(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { flush() }, SAVE_DELAY_MS)
  }, [flush])

  const apply = useCallback(async () => {
    await flush()
    const r = await window.api.applyBrand()
    setServerIssues(r.ok ? [] : r.issues)
    if (r.ok) setDirty(false)
    return r
  }, [flush])

  const localIssues = draft ? validateProfile(draft, { botNumber, productCount }) : []
  const issues = [...localIssues, ...serverIssues.filter((s) => !localIssues.some((l) => l.message === s.message))]

  return { draft, update, flush, apply, reload: load, issues, dirty, botNumber }
}

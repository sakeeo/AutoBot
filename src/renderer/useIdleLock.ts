import { useEffect, useRef } from 'react'

const ACTIVITY = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'] as const

/** Calls `onIdle` after `minutes` without user activity. 0 (or less) turns it off. */
export function useIdleLock(minutes: number, onIdle: () => void): void {
  const cb = useRef(onIdle)
  cb.current = onIdle
  useEffect(() => {
    if (minutes <= 0) return
    let timer: ReturnType<typeof setTimeout>
    const arm = (): void => {
      clearTimeout(timer)
      timer = setTimeout(() => cb.current(), minutes * 60_000)
    }
    arm()
    for (const e of ACTIVITY) window.addEventListener(e, arm, { passive: true })
    return () => {
      clearTimeout(timer)
      for (const e of ACTIVITY) window.removeEventListener(e, arm)
    }
  }, [minutes])
}

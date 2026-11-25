import { useEffect, useRef, useState } from 'react'

/** Motion is skipped when the user asked for less of it, and where matchMedia does not exist (tests). */
export function canAnimate(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Eases a number up to its target on first show and between later values. Final value is always the real one. */
export function useCountUp(target: number, ms = 800): number {
  const [value, setValue] = useState(() => (canAnimate() ? 0 : target))
  const from = useRef(canAnimate() ? 0 : target)
  useEffect(() => {
    if (!canAnimate()) { setValue(target); from.current = target; return }
    const start = performance.now()
    const begin = from.current
    let raf = 0
    const tick = (now: number): void => {
      const p = Math.min(1, (now - start) / ms)
      const eased = 1 - Math.pow(1 - p, 3)
      const v = p >= 1 ? target : Math.round(begin + (target - begin) * eased)
      from.current = v
      setValue(v)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return value
}

export function Counter({ value }: { value: number }) {
  return <>{useCountUp(value)}</>
}

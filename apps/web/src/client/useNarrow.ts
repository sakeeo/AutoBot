import { useEffect, useState } from 'react'

/** True below the desktop breakpoint (phones, small tablets). Starts false so the server and the browser agree. */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia?.('(max-width: 991.98px)')
    if (!mq) return
    const on = (): void => setNarrow(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow
}

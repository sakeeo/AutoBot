import type { ReactNode } from 'react'
export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

const CLASS: Record<Tone, string> = {
  success: 'text-bg-success',
  warning: 'text-bg-warning',
  danger: 'text-bg-danger',
  info: 'text-bg-info',
  neutral: 'text-bg-secondary'
}

/** Status is always written out; colour only reinforces it (design-guide §7, §10). */
export function StatusBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`badge ${CLASS[tone]}`}>{children}</span>
}

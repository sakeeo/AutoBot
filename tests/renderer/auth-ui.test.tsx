// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import { App } from '../../src/renderer/App'
import { useIdleLock } from '../../src/renderer/useIdleLock'
import type { AuthState } from '../../src/shared/ipc'
import type { Settings } from '../../src/shared/types'

const settings: Settings = {
  knowledgeFolders: [], excludePatterns: [], mode: 'extractive',
  outOfContext: { action: 'reply', replyText: 'Maaf' }, threshold: 0.6, allowGroups: false, cooldownSec: 10,
  ai: { provider: 'claude', model: 'claude-haiku-5-5', maxTokens: 400 }, autoStart: false, theme: 'auto'
}
const period = { replied: 0, refused: 0, handoff: 0, errors: 0, links: 0 }
const off: AuthState = { enabled: false, locked: false, username: null, autoLockMin: 0 }
const locked: AuthState = { enabled: true, locked: true, username: 'admin', autoLockMin: 0 }
const open: AuthState = { enabled: true, locked: false, username: 'admin', autoLockMin: 0 }

function setApi(state: AuthState, over: Record<string, unknown> = {}) {
  const api = {
    authState: vi.fn().mockResolvedValue(state),
    authLogin: vi.fn().mockResolvedValue({ ok: true }),
    authLock: vi.fn().mockResolvedValue(undefined),
    authSetup: vi.fn().mockResolvedValue({ ok: true, recoveryCode: 'AAAA-BBBB-CCCC-DDDD' }),
    authChangePassword: vi.fn().mockResolvedValue({ ok: true }),
    authReset: vi.fn().mockResolvedValue({ ok: true, recoveryCode: '1111-2222-3333-4444' }),
    authDisable: vi.fn().mockResolvedValue({ ok: true }),
    authSetAutoLock: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn().mockResolvedValue({ state: 'disconnected' }),
    onStatus: vi.fn().mockReturnValue(() => undefined),
    getSettings: vi.fn().mockResolvedValue(settings),
    updateSettings: vi.fn().mockImplementation(async (p) => ({ ...settings, ...p })),
    getDashboard: vi.fn().mockResolvedValue({ today: period, week: period, waitingAdmin: 0, recent: [], files: { indexed: 0, failed: 0 } }),
    getBrand: vi.fn(), hasApiKey: vi.fn().mockResolvedValue(false),
    ...over
  }
  ;(window as any).api = api
  return api
}

beforeEach(() => {
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, addEventListener: () => undefined, removeEventListener: () => undefined
  })) as unknown as typeof window.matchMedia
})
afterEach(() => { cleanup(); vi.useRealTimers() })

const type = (label: RegExp | string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })

async function openSecurity() {
  fireEvent.click(await screen.findByRole('button', { name: /pengaturan/i }))
  fireEvent.click(screen.getByRole('button', { name: /keamanan/i }))
}

describe('lock screen', () => {
  it('shows only the lock screen while locked and loads no data', async () => {
    const api = setApi(locked)
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Masuk' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /pengaturan/i })).toBeNull()
    expect(api.getSettings).not.toHaveBeenCalled()
    expect(api.getDashboard).not.toHaveBeenCalled()
  })

  it('shows a clear message for a wrong password and stays locked', async () => {
    const api = setApi(locked, { authLogin: vi.fn().mockResolvedValue({ ok: false, error: 'bad' }) })
    render(<App />)
    await screen.findByRole('button', { name: 'Masuk' })
    type(/username/i, 'admin'); type(/^password$/i, 'salah')
    fireEvent.click(screen.getByRole('button', { name: 'Masuk' }))
    expect(await screen.findByText(/username atau password salah/i)).toBeTruthy()
    expect(api.authLogin).toHaveBeenCalledWith('admin', 'salah')
    expect(screen.queryByRole('button', { name: /pengaturan/i })).toBeNull()
  })

  it('tells the user when too many attempts were made', async () => {
    setApi(locked, { authLogin: vi.fn().mockResolvedValue({ ok: false, error: 'throttled' }) })
    render(<App />)
    await screen.findByRole('button', { name: 'Masuk' })
    type(/username/i, 'admin'); type(/^password$/i, 'x')
    fireEvent.click(screen.getByRole('button', { name: 'Masuk' }))
    expect(await screen.findByText(/terlalu banyak percobaan/i)).toBeTruthy()
  })

  it('opens the app after a correct login', async () => {
    const api = setApi(locked)
    api.authState.mockResolvedValueOnce(locked).mockResolvedValue(open)
    render(<App />)
    await screen.findByRole('button', { name: 'Masuk' })
    type(/username/i, 'admin'); type(/^password$/i, 'rahasia-123')
    fireEvent.click(screen.getByRole('button', { name: 'Masuk' }))
    expect(await screen.findByRole('button', { name: /pengaturan/i })).toBeTruthy()
  })

  it('resets the password with the recovery code and shows the new code', async () => {
    const api = setApi(locked)
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /lupa password/i }))
    type(/kode pemulihan/i, 'AAAA-BBBB-CCCC-DDDD'); type(/password baru/i, 'baru-baru-1')
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }))
    expect(await screen.findByText('1111-2222-3333-4444')).toBeTruthy()
    expect(api.authReset).toHaveBeenCalledWith('AAAA-BBBB-CCCC-DDDD', 'baru-baru-1')
  })

  it('returns to the lock screen when any call is refused with LOCKED', async () => {
    const api = setApi(open)
    render(<App />)
    await screen.findByRole('button', { name: /pengaturan/i })
    api.authState.mockResolvedValue(locked)
    const ev = new Event('unhandledrejection', { cancelable: true })
    Object.assign(ev, { reason: new Error("Error invoking remote method 'log:get': Error: LOCKED") })
    await act(async () => { window.dispatchEvent(ev) })
    expect(await screen.findByRole('button', { name: 'Masuk' })).toBeTruthy()
  })
})

describe('security page', () => {
  it('validates before enabling login: mismatch and short password never reach the API', async () => {
    const api = setApi(off)
    render(<App />)
    await openSecurity()
    type(/^username/i, 'admin'); type(/^password$/i, 'rahasia-123'); type(/ulangi password/i, 'beda-beda-1')
    fireEvent.click(screen.getByRole('button', { name: /aktifkan login/i }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/password tidak sama/i)
    type(/^password$/i, 'pendek'); type(/ulangi password/i, 'pendek')
    fireEvent.click(screen.getByRole('button', { name: /aktifkan login/i }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/minimal 8 karakter/i))
    expect(api.authSetup).not.toHaveBeenCalled()
  })

  it('shows the recovery code once after enabling login', async () => {
    const api = setApi(off)
    render(<App />)
    await openSecurity()
    type(/^username/i, 'admin'); type(/^password$/i, 'rahasia-123'); type(/ulangi password/i, 'rahasia-123')
    api.authState.mockResolvedValue(open)
    fireEvent.click(screen.getByRole('button', { name: /aktifkan login/i }))
    expect(await screen.findByText('AAAA-BBBB-CCCC-DDDD')).toBeTruthy()
    expect(api.authSetup).toHaveBeenCalledWith('admin', 'rahasia-123')
    fireEvent.click(screen.getByRole('button', { name: /sudah menyimpannya/i }))
    await waitFor(() => expect(screen.queryByText('AAAA-BBBB-CCCC-DDDD')).toBeNull())
  })

  it('with login on: change password, lock now, auto-lock, disable, and the honesty note', async () => {
    const api = setApi(open)
    render(<App />)
    await openSecurity()
    expect(await screen.findByText(/hanya mengunci tampilan aplikasi, bukan mengenkripsi/i)).toBeTruthy()

    type(/password lama/i, 'rahasia-123'); type(/password baru/i, 'baru-baru-1')
    fireEvent.click(screen.getByRole('button', { name: /ganti password/i }))
    await waitFor(() => expect(api.authChangePassword).toHaveBeenCalledWith('rahasia-123', 'baru-baru-1'))

    fireEvent.change(screen.getByLabelText(/kunci otomatis/i), { target: { value: '5' } })
    fireEvent.blur(screen.getByLabelText(/kunci otomatis/i))
    await waitFor(() => expect(api.authSetAutoLock).toHaveBeenCalledWith(5))

    type(/password untuk menonaktifkan/i, 'baru-baru-1')
    fireEvent.click(screen.getByRole('button', { name: /nonaktifkan login/i }))
    await waitFor(() => expect(api.authDisable).toHaveBeenCalledWith('baru-baru-1'))

    fireEvent.click(screen.getByRole('button', { name: /kunci sekarang/i }))
    await waitFor(() => expect(api.authLock).toHaveBeenCalled())
  })
})

describe('useIdleLock', () => {
  function Probe({ minutes, onIdle }: { minutes: number; onIdle: () => void }) {
    useIdleLock(minutes, onIdle)
    return null
  }

  it('fires after the idle period, is postponed by activity, and is off at 0', () => {
    vi.useFakeTimers()
    const fire = vi.fn()
    const { rerender } = render(<Probe minutes={1} onIdle={fire} />)
    act(() => { vi.advanceTimersByTime(59_000) })
    expect(fire).not.toHaveBeenCalled()
    act(() => { window.dispatchEvent(new Event('mousemove')) })
    act(() => { vi.advanceTimersByTime(59_000) })
    expect(fire).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(2_000) })
    expect(fire).toHaveBeenCalledTimes(1)

    fire.mockClear()
    rerender(<Probe minutes={0} onIdle={fire} />)
    act(() => { vi.advanceTimersByTime(10 * 60_000) })
    expect(fire).not.toHaveBeenCalled()
  })
})

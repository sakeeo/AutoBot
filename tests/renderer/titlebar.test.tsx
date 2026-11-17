// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react'
import { TitleBar } from '../../src/renderer/shell/TitleBar'

afterEach(cleanup)

function setApi(maximized = false) {
  let push: ((m: boolean) => void) | null = null
  const api = {
    winMinimize: vi.fn().mockResolvedValue(undefined),
    winToggleMaximize: vi.fn().mockResolvedValue(undefined),
    winClose: vi.fn().mockResolvedValue(undefined),
    winIsMaximized: vi.fn().mockResolvedValue(maximized),
    onWinMaximized: vi.fn().mockImplementation((cb: (m: boolean) => void) => { push = cb; return () => undefined })
  }
  ;(window as any).api = api
  return { api, emit: (m: boolean) => act(async () => { push?.(m) }) }
}

describe('TitleBar', () => {
  it('minimises, maximises and closes through the backend', async () => {
    const { api } = setApi()
    render(<TitleBar />)
    fireEvent.click(screen.getByRole('button', { name: 'Minimalkan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Maksimalkan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Tutup' }))
    expect(api.winMinimize).toHaveBeenCalled()
    expect(api.winToggleMaximize).toHaveBeenCalled()
    expect(api.winClose).toHaveBeenCalled()
  })
  it('offers to restore while maximised and follows the window state', async () => {
    const { emit } = setApi(true)
    render(<TitleBar />)
    expect(await screen.findByRole('button', { name: 'Pulihkan' })).toBeTruthy()
    await emit(false)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Maksimalkan' })).toBeTruthy())
  })
  it('double-clicking the bar toggles maximise', () => {
    const { api } = setApi()
    const { container } = render(<TitleBar />)
    fireEvent.doubleClick(container.querySelector('.app-titlebar')!)
    expect(api.winToggleMaximize).toHaveBeenCalledTimes(1)
  })
})

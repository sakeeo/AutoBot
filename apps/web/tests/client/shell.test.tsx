// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, within, waitFor } from '@testing-library/react'
vi.mock('next/link', () => ({ default: ({ href, children, ...p }: any) => <a href={href} {...p}>{children}</a> }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => '/' }))
import { Sidebar } from '../../src/client/shell/Sidebar'
import { BottomNav } from '../../src/client/shell/BottomNav'
import { MorePage } from '../../src/client/pages/MorePage'
import { keyOfPath, bottomKeyOf, groupOf } from '../../src/client/nav'

afterEach(cleanup)

describe('navigation (Figma)', () => {
  it('the desktop sidebar is one flat list in the Figma order, with the current page marked', () => {
    render(<Sidebar page="ai" />)
    const nav = screen.getByRole('navigation', { name: 'Menu utama' })
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(
      ['Dashboard', 'Pesan', 'Uji Jawaban', 'Log', 'Pengetahuan', 'Brand & Konversi', 'Connector', 'AI', 'Keamanan'])
    expect(within(nav).getByRole('link', { name: 'AI' }).getAttribute('aria-current')).toBe('page')
  })

  it('the phone bar has four tabs and lights "Lainnya" for a settings page', () => {
    render(<BottomNav page="security" />)
    const links = screen.getAllByRole('link')
    expect(links.map((a) => a.textContent)).toEqual(['Beranda', 'Pesan', 'Uji', 'Lainnya'])
    expect(links[3].getAttribute('aria-current')).toBe('page')
    expect(links[3].getAttribute('href')).toBe('/lainnya')
  })

  it('"Lainnya" lists every settings page and a sign-out', () => {
    render(<MorePage />)
    for (const [name, href] of [['Log', '/log'], ['Pengetahuan', '/pengaturan/pengetahuan'], ['AI', '/pengaturan/ai'], ['Keamanan', '/pengaturan/keamanan']])
      expect(screen.getByRole('link', { name: new RegExp(`^${name}`) }).getAttribute('href')).toBe(href)
    expect(screen.getByRole('button', { name: /keluar/i })).toBeTruthy()
  })

  it('maps paths to pages', () => {
    expect(keyOfPath('/pengaturan/ai')).toBe('ai')
    expect(keyOfPath('/lainnya')).toBe('more')
    expect(keyOfPath('/pesan')).toBe('messages')
    expect(bottomKeyOf('connector')).toBe('more')
    expect(groupOf('test')).toBe('top')
  })
})

describe('top bar pills', () => {
  it('shows the panel and the bot state in words', async () => {
    const { TopBar } = await import('../../src/client/shell/TopBar')
    const { SettingsProvider } = await import('../../src/client/settings-context')
    ;(window as any).api = {
      getStatus: vi.fn().mockResolvedValue({ state: 'connected' }), onStatus: vi.fn().mockReturnValue(() => undefined),
      getBotEnabled: vi.fn().mockResolvedValue(false), getDashboard: vi.fn().mockResolvedValue({ waitingAdmin: 0 }),
      getSettings: vi.fn().mockResolvedValue({ theme: 'light' }), updateSettings: vi.fn()
    }
    render(<SettingsProvider><TopBar page="dashboard" narrow={false} username="budi" /></SettingsProvider>)
    expect(await screen.findByText('Panel aktif')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('Bot: nonaktif')).toBeTruthy())
  })
})

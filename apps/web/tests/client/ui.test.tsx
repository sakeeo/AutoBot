// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { PageHeader } from '../../src/client/ui/PageHeader'
import { Card } from '../../src/client/ui/Card'
import { StatusBadge } from '../../src/client/ui/StatusBadge'
import { LoadingState, EmptyState, ErrorState } from '../../src/client/ui/States'
import { ConfirmButton } from '../../src/client/ui/ConfirmButton'
import { DataTable } from '../../src/client/ui/DataTable'
import { TagInput } from '../../src/client/brand/TagInput'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

afterEach(cleanup)

describe('PageHeader and Card', () => {
  it('PageHeader renders one h1 with the title, an optional subtitle and actions', () => {
    render(<PageHeader icon="bi-gear" title="Judul" subtitle="Penjelasan" actions={<button>Aksi</button>} />)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'Judul' })).toBeTruthy()
    expect(screen.getByText('Penjelasan')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Aksi' })).toBeTruthy()
  })
  it('Card with a title is a named region with a level-3 heading, a header and a body', () => {
    render(<Card title="Hari ini" actions={<button>Unduh</button>}><p>isi</p></Card>)
    const region = screen.getByRole('region', { name: 'Hari ini' })
    expect(within(region).getByRole('heading', { level: 3, name: 'Hari ini' })).toBeTruthy()
    expect(within(region).getByText('isi')).toBeTruthy()
    expect(within(region).getByRole('button', { name: 'Unduh' })).toBeTruthy()
  })
})

describe('StatusBadge', () => {
  it('always renders its text and a tone class', () => {
    render(<StatusBadge tone="success">Terindeks</StatusBadge>)
    const b = screen.getByText('Terindeks')
    expect(b.className).toMatch(/badge/)
    expect(b.className).toMatch(/text-bg-success/)
  })
  it('maps every tone to a different style', () => {
    const tones = ['success', 'warning', 'danger', 'info', 'neutral'] as const
    const classes = tones.map((t) => {
      const { container, unmount } = render(<StatusBadge tone={t}>x</StatusBadge>)
      const c = container.firstElementChild!.className
      unmount()
      return c
    })
    expect(new Set(classes).size).toBe(5)
  })
})

describe('states', () => {
  it('LoadingState is a status region with default text', () => {
    render(<LoadingState />)
    expect(screen.getByRole('status').textContent).toMatch(/memuat/i)
  })
  it('ErrorState is an alert and "Coba lagi" retries', () => {
    const retry = vi.fn()
    render(<ErrorState message="Gagal memuat." onRetry={retry} />)
    expect(screen.getByRole('alert').textContent).toMatch(/gagal memuat/i)
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })
  it('ErrorState without onRetry has no retry button', () => {
    render(<ErrorState message="Gagal." />)
    expect(screen.queryByRole('button', { name: 'Coba lagi' })).toBeNull()
  })
  it('EmptyState explains the next step', () => {
    render(<EmptyState title="Belum ada data" hint="Pilih folder dulu." />)
    expect(screen.getByText('Belum ada data')).toBeTruthy()
    expect(screen.getByText('Pilih folder dulu.')).toBeTruthy()
  })
})

describe('ConfirmButton', () => {
  it('the first click never confirms; only the confirm button does, exactly once', () => {
    const onConfirm = vi.fn()
    render(<ConfirmButton label="Hapus" onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('button', { name: 'Hapus' }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByText(/yakin/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Hapus' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/yakin/i)).toBeNull()
  })
  it('Batal and Escape cancel without confirming and bring the original button back', () => {
    const onConfirm = vi.fn()
    render(<ConfirmButton label="Hapus" onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('button', { name: 'Hapus' }))
    fireEvent.click(screen.getByRole('button', { name: 'Batal' }))
    expect(screen.getByRole('button', { name: 'Hapus' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Hapus' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText(/yakin/i)).toBeNull()
    expect(onConfirm).not.toHaveBeenCalled()
  })
  it('uses a custom confirm label and names the confirm button after the icon button label', () => {
    render(<ConfirmButton label="Hapus" ariaLabel="Hapus tautan 1" confirmLabel="Ya, hapus" onConfirm={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Hapus tautan 1' }))
    expect(screen.getByRole('button', { name: 'Ya, Hapus tautan 1' })).toBeTruthy()
  })
  it('a disabled button cannot start a confirmation', () => {
    render(<ConfirmButton label="Hapus" disabled onConfirm={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Hapus' }))
    expect(screen.queryByText(/yakin/i)).toBeNull()
  })
})

describe('DataTable', () => {
  type Row = { id: string; name: string; n: number }
  const rows: Row[] = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, name: `Baris ${i + 1}`, n: i * 10 }))
  const columns = [
    { key: 'name', header: 'Nama', render: (r: Row) => r.name },
    { key: 'n', header: 'Angka', align: 'end' as const, render: (r: Row) => String(r.n) }
  ]
  const table = (props: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) =>
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} caption="Contoh" empty={<p>Kosong</p>} {...props} />)

  it('renders column headers with scope and right-aligns numeric columns', () => {
    table()
    const headers = screen.getAllByRole('columnheader')
    expect(headers.map((h) => h.textContent)).toEqual(['Nama', 'Angka'])
    for (const h of headers) expect(h.getAttribute('scope')).toBe('col')
    expect(headers[1].className).toMatch(/text-end/)
    expect(screen.getByText('Baris 2').closest('td')!.className).not.toMatch(/text-end/)
    expect(screen.getByText('10').closest('td')!.className).toMatch(/text-end/)
  })
  it('paginates and shows the range', () => {
    table({ pageSize: 2 })
    expect(screen.getAllByRole('row')).toHaveLength(3) // header + 2
    expect(screen.getByText('1–2 dari 5')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Sebelumnya' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Berikutnya' }))
    expect(screen.getByText('3–4 dari 5')).toBeTruthy()
    expect(screen.getByText('Baris 3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Berikutnya' }))
    expect(screen.getByText('5–5 dari 5')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Berikutnya' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Sebelumnya' }))
    expect(screen.getByText('3–4 dari 5')).toBeTruthy()
  })
  it('has no pager when everything fits on one page', () => {
    table({ pageSize: 10 })
    expect(screen.queryByRole('button', { name: 'Berikutnya' })).toBeNull()
  })
  it('shows the empty node instead of a table when there are no rows', () => {
    table({ rows: [] })
    expect(screen.getByText('Kosong')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
  it('goes back to a valid page when the rows shrink', () => {
    const { rerender } = table({ pageSize: 2 })
    fireEvent.click(screen.getByRole('button', { name: 'Berikutnya' }))
    fireEvent.click(screen.getByRole('button', { name: 'Berikutnya' }))
    rerender(<DataTable columns={columns} rows={rows.slice(0, 1)} rowKey={(r) => r.id} caption="Contoh" pageSize={2} empty={<p>Kosong</p>} />)
    expect(screen.getByText('Baris 1')).toBeTruthy()
  })
})

describe('ConfirmButton layout', () => {
  const css = readFileSync(join(__dirname, '../../src/client/styles/ui.css'), 'utf8')
  it('asking state is a popover that keeps the trigger footprint, so narrow table cells never overflow', () => {
    const { container } = render(<ConfirmButton label="Hapus" ariaLabel="Hapus x" onConfirm={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Hapus x' }))
    expect(container.querySelector('.confirm-wrap')).not.toBeNull()
    expect(container.querySelector('.confirm-pop')).not.toBeNull()
    const ghost = container.querySelector('.confirm-ghost')!
    expect(ghost.getAttribute('aria-hidden')).toBe('true')
    expect(ghost.getAttribute('tabindex')).toBe('-1')
    const pop = css.slice(css.indexOf('.confirm-pop {'), css.indexOf('}', css.indexOf('.confirm-pop {')))
    expect(pop).toMatch(/position:\s*absolute/)
    expect(pop).toMatch(/white-space:\s*nowrap/)
  })
  it('focus returns to the trigger after confirming too', () => {
    render(<ConfirmButton label="Hapus" onConfirm={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Hapus' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hapus' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Hapus' }))
  })
})

describe('TagInput remove button', () => {
  it('is a visible icon button (not a white close button on a light chip) with a usable target', () => {
    render(<TagInput id="t" label="Kata" tags={['promo']} onChange={() => undefined} />)
    const b = screen.getByRole('button', { name: 'Hapus promo' })
    expect(b.className).toMatch(/tag-remove/)
    expect(b.className).not.toMatch(/btn-close/)
    const css = readFileSync(join(__dirname, '../../src/client/styles/ui.css'), 'utf8')
    const rule = css.slice(css.indexOf('.tag-remove {'), css.indexOf('}', css.indexOf('.tag-remove {')))
    expect(rule).toMatch(/color:\s*inherit/)
    expect(Number(/width:\s*(\d+)px/.exec(rule)?.[1])).toBeGreaterThanOrEqual(20)
  })
})


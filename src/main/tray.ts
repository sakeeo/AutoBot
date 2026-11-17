import { app, Menu, Tray, nativeImage } from 'electron'

export interface TrayHandle {
  refresh(statusLabel: string): void
}

/** Returns null when the platform has no usable tray (the window then closes normally). */
export function createTray(opts: { iconPath: string; showWindow(): void }): TrayHandle | null {
  try {
    const icon = nativeImage.createFromPath(opts.iconPath)
    if (icon.isEmpty()) return null
    const tray = new Tray(icon)
    tray.setToolTip('AutoBot — Balas WA Otomatis pakai AI')
    tray.on('click', () => opts.showWindow())
    const refresh = (statusLabel: string): void => {
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: 'Buka AutoBot', click: () => opts.showWindow() },
          { label: `Status: ${statusLabel}`, enabled: false },
          { type: 'separator' },
          { label: 'Keluar', click: () => app.quit() }
        ])
      )
    }
    refresh('Terputus')
    return { refresh }
  } catch {
    return null
  }
}

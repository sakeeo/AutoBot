import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS as C } from '../shared/channels'
import type { Api } from '../shared/ipc'

const subscribe =
  <T>(channel: string) =>
  (cb: (payload: T) => void): (() => void) => {
    const handler = (_e: unknown, payload: T): void => cb(payload)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }

const api: Api = {
  getStatus: () => ipcRenderer.invoke(C.getStatus),
  connect: () => ipcRenderer.invoke(C.connect),
  logout: () => ipcRenderer.invoke(C.logout),
  onStatus: subscribe(C.evtStatus),
  getSettings: () => ipcRenderer.invoke(C.getSettings),
  updateSettings: (patch) => ipcRenderer.invoke(C.updateSettings, patch),
  pickFolder: () => ipcRenderer.invoke(C.pickFolder),
  listFiles: () => ipcRenderer.invoke(C.listFiles),
  reindex: () => ipcRenderer.invoke(C.reindex),
  onIndexStatus: subscribe(C.evtIndexStatus),
  testQuestion: (q) => ipcRenderer.invoke(C.testQuestion, q),
  saveApiKey: (key) => ipcRenderer.invoke(C.saveApiKey, key),
  hasApiKey: () => ipcRenderer.invoke(C.hasApiKey),
  deleteApiKey: () => ipcRenderer.invoke(C.deleteApiKey),
  openConsole: () => ipcRenderer.invoke(C.openConsole),
  getLog: (limit) => ipcRenderer.invoke(C.getLog, limit),
  onEscalate: subscribe(C.evtEscalate),
  getBrand: () => ipcRenderer.invoke(C.getBrand),
  saveBrandDraft: (p) => ipcRenderer.invoke(C.saveBrandDraft, p),
  applyBrand: () => ipcRenderer.invoke(C.applyBrand),
  listBrandVersions: () => ipcRenderer.invoke(C.listBrandVersions),
  restoreBrandVersion: (v) => ipcRenderer.invoke(C.restoreBrandVersion, v),
  exportBrand: () => ipcRenderer.invoke(C.exportBrand),
  importBrand: (json) => ipcRenderer.invoke(C.importBrand, json),
  previewChat: (input) => ipcRenderer.invoke(C.previewChat, input),
  listPresets: () => ipcRenderer.invoke(C.listPresets),
  loadPreset: (id) => ipcRenderer.invoke(C.loadPreset, id),
  onHandoff: subscribe(C.evtHandoff)
}

contextBridge.exposeInMainWorld('api', api)

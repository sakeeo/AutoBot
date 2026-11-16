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
  bcOverview: () => ipcRenderer.invoke(C.bcOverview),
  bcContacts: (f) => ipcRenderer.invoke(C.bcContacts, f),
  bcSuppressed: () => ipcRenderer.invoke(C.bcSuppressed),
  bcImportPreview: (file) => ipcRenderer.invoke(C.bcImportPreview, file),
  bcImportCommit: (id, attest) => ipcRenderer.invoke(C.bcImportCommit, id, attest),
  bcSendConfirmations: () => ipcRenderer.invoke(C.bcSendConfirmations),
  bcCampaigns: () => ipcRenderer.invoke(C.bcCampaigns),
  bcCreateCampaign: (i) => ipcRenderer.invoke(C.bcCreateCampaign, i),
  bcPreviewCampaign: (id) => ipcRenderer.invoke(C.bcPreviewCampaign, id),
  bcStartCampaign: (id, text) => ipcRenderer.invoke(C.bcStartCampaign, id, text),
  bcPauseCampaign: (id) => ipcRenderer.invoke(C.bcPauseCampaign, id),
  bcResumeCampaign: (id) => ipcRenderer.invoke(C.bcResumeCampaign, id),
  bcStopCampaign: (id) => ipcRenderer.invoke(C.bcStopCampaign, id),
  bcStopAll: () => ipcRenderer.invoke(C.bcStopAll),
  bcGetSafety: () => ipcRenderer.invoke(C.bcGetSafety),
  bcSetSafety: (p) => ipcRenderer.invoke(C.bcSetSafety, p),
  bcReport: (id) => ipcRenderer.invoke(C.bcReport, id),
  bcExportReport: (id) => ipcRenderer.invoke(C.bcExportReport, id),
  bcEraseContact: (id) => ipcRenderer.invoke(C.bcEraseContact, id),
  onBroadcast: subscribe(C.evtBroadcast),
  listChats: () => ipcRenderer.invoke(C.listChats),
  getThread: (chatId) => ipcRenderer.invoke(C.getThread, chatId),
  onMessage: subscribe(C.evtMessage),
  getDashboard: () => ipcRenderer.invoke(C.getDashboard),
  onAuthLocked: subscribe<void>(C.evtAuthLocked),
  authState: () => ipcRenderer.invoke(C.authState),
  authLogin: (u, p) => ipcRenderer.invoke(C.authLogin, u, p),
  authLock: () => ipcRenderer.invoke(C.authLock),
  authSetup: (u, p) => ipcRenderer.invoke(C.authSetup, u, p),
  authChangePassword: (o, n) => ipcRenderer.invoke(C.authChangePassword, o, n),
  authReset: (c, n) => ipcRenderer.invoke(C.authReset, c, n),
  authDisable: (p) => ipcRenderer.invoke(C.authDisable, p),
  authSetAutoLock: (m) => ipcRenderer.invoke(C.authSetAutoLock, m),
  onHandoff: subscribe(C.evtHandoff)
}

contextBridge.exposeInMainWorld('api', api)

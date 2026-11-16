/**
 * Every IPC channel. Kept free of runtime dependencies so the sandboxed preload can import it.
 * There is deliberately no channel that returns the API key or login credentials.
 */
export const CHANNELS = {
  getStatus: 'wa:get-status',
  connect: 'wa:connect',
  logout: 'wa:logout',
  getSettings: 'settings:get',
  updateSettings: 'settings:update',
  pickFolder: 'knowledge:pick-folder',
  listFiles: 'knowledge:list-files',
  reindex: 'knowledge:reindex',
  testQuestion: 'answer:test',
  saveApiKey: 'ai:save-key',
  hasApiKey: 'ai:has-key',
  deleteApiKey: 'ai:delete-key',
  openConsole: 'ai:open-console',
  getLog: 'log:get',
  evtStatus: 'evt:status',
  evtIndexStatus: 'evt:index-status',
  evtEscalate: 'evt:escalate'
} as const

import { z } from 'zod'
import { PROVIDER_IDS } from './providers'
import type { BrandProfile, Issue } from './brand'
import type { Answer, ConnStatus, Decision, Settings } from './types'
import type { BContact, BroadcastEvent, Campaign, CampaignView, ContactStatus, ImportPreviewView, OverviewView, ReportView, SafetyView, SuppressReason } from './broadcast'

export { CHANNELS } from './channels'

export const SettingsPatchSchema = z
  .object({
    knowledgeFolders: z.array(z.string().min(1)).max(20),
    excludePatterns: z.array(z.string().max(300)).max(200),
    mode: z.enum(['extractive', 'ai']),
    outOfContext: z
      .object({ action: z.enum(['reply', 'silent', 'escalate']), replyText: z.string().max(1000) })
      .strict(),
    threshold: z.number().min(0).max(1),
    allowGroups: z.boolean(),
    cooldownSec: z.number().int().min(0).max(3600),
    ai: z
      .object({
        provider: z.enum(PROVIDER_IDS),
        // Empty is allowed so the user can pick "custom" before typing a model; save-time checks enforce it.
        model: z.string().max(100),
        maxTokens: z.number().int().min(16).max(4096),
        baseUrl: z
          .string()
          .max(300)
          .refine((u) => u === '' || /^https?:\/\/[^\s/]+/i.test(u), 'URL harus diawali http:// atau https://')
          .optional()
      })
      .strict(),
    autoStart: z.boolean(),
    theme: z.enum(['light', 'dark', 'auto']),
    notifyIncoming: z.boolean(),
    memoryEnabled: z.boolean()
  })
  .partial()
  .strict()

export const AuthSetupSchema = z
  .object({ username: z.string().trim().min(1).max(40), password: z.string().min(8).max(200) })
  .strict()
export interface AuthState { enabled: boolean; locked: boolean; username: string | null; autoLockMin: number }
export type AuthResult = { ok: true } | { ok: false; error: 'bad' | 'throttled' | 'invalid' }

export const ApiKeySchema = z.string().trim().min(10).max(500)
export const ChatIdSchema = z.string().min(1).max(200)
export const MemoryPatchSchema = z
  .object({
    summary: z.string().max(700),
    facts: z.record(z.string().trim().min(1).max(40), z.string().trim().min(1).max(80)).refine((f) => Object.keys(f).length <= 12, 'Maksimal 12 fakta')
  })
  .partial()
  .strict()
export const BulkHandlingSchema = z
  .object({ chatIds: z.array(z.string().min(1).max(200)).min(1).max(500), to: z.enum(['manusia', 'bot']) })
  .strict()
export const QuestionSchema = z.string().trim().min(1).max(2000)
export const LimitSchema = z.number().int().min(1).max(500)

export interface DashboardPeriod { replied: number; refused: number; handoff: number; errors: number; links: number }
/** One local calendar day of bot decisions, for the trend chart. */
export interface DashboardDay { day: string; replied: number; refused: number; handoff: number; errors: number }
export interface DashboardData {
  today: DashboardPeriod
  week: DashboardPeriod
  /** The last seven local days, oldest first, today last. */
  trend: DashboardDay[]
  waitingAdmin: number
  recent: LogRow[]
  files: { indexed: number; failed: number }
}

export interface FeedMessage {
  id: number
  chatId: string
  direction: 'in' | 'out' | 'human'
  text: string
  at: number
  isGroup: boolean
}
/** Who answers a chat: the bot, the bot's handoff waiting for an admin, or a person who took over. */
export type Handling = 'bot' | 'menunggu_admin' | 'manusia'
export interface ChatSummary { chatId: string; isGroup: boolean; last: FeedMessage; count: number; handling: Handling }

export interface FileInfo {
  file: string
  status: 'indexed' | 'failed'
  chunks: number
  reason?: string
}
export interface IndexStatusEvent {
  file: string
  status: 'indexed' | 'failed' | 'removed'
  reason?: string
}
export interface LogRow {
  message_id: string
  chat_id: string
  decision: string
  top_score: number | null
  sources: string | null
  created_at: number
  text: string | null
}
/** What one simulated or previewed AI turn did (mirrors the agent's result, minus internals). */
export interface AgentTurnView {
  intent: string
  action: { kind: string; ruleId: string | null; forced: boolean; reason?: string; linkId?: string; productId?: string; adminId?: string }
  replyParts: string[]
  linkSent: string | null
  handoff: { reason: string } | null
  sources: string[]
  matchedRule: string | null
  removed: { numbers: boolean; urls: string[]; numbersUnknown: string[]; cta?: boolean }
  fallback: boolean
  attempts?: number
  fallbackReason?: 'timeout' | 'auth' | 'rate_limit' | 'network' | 'unusable'
  hits: { file: string; text: string; coverage: number }[]
}
export interface TestResult {
  decision: Decision
  answer: Answer | null
  via: 'extractive' | 'ai' | null
  agent?: AgentTurnView
}
export interface BrandSnapshot {
  active: BrandProfile
  draft: BrandProfile
  botNumber: string | null
  productCount: number
}
export type PreviewChatResult = { ok: true; turns: AgentTurnView[] } | { ok: false; error: string }

export const PreviewInputSchema = z
  .object({ draft: z.boolean(), messages: z.array(QuestionSchema).min(1).max(10) })
  .strict()
export const VersionSchema = z.number().int().min(0)
export const MAX_BRAND_JSON = 200_000

export interface Api {
  getStatus(): Promise<ConnStatus>
  connect(): Promise<void>
  logout(): Promise<void>
  onStatus(cb: (s: ConnStatus) => void): () => void
  winMinimize(): Promise<void>
  winToggleMaximize(): Promise<void>
  winClose(): Promise<void>
  winIsMaximized(): Promise<boolean>
  onWinMaximized(cb: (maximized: boolean) => void): () => void
  getSettings(): Promise<Settings>
  updateSettings(patch: unknown): Promise<Settings>
  pickFolder(): Promise<string | null>
  listFiles(): Promise<FileInfo[]>
  reindex(): Promise<void>
  /** Opens a file picker and copies the chosen files into a knowledge folder (default: the first one). */
  kbUpload(folder?: string): Promise<{ canceled: boolean; folder: string | null; added: string[]; rejected: { name: string; reason: string }[] }>
  /** Saves a copy of an indexed knowledge file where the user chooses. */
  kbDownload(file: string): Promise<{ ok: boolean; canceled?: boolean }>
  /** Deletes an indexed knowledge file from disk and the index. */
  kbDelete(file: string): Promise<{ ok: boolean }>
  onIndexStatus(cb: (e: IndexStatusEvent) => void): () => void
  testQuestion(q: string): Promise<TestResult>
  saveApiKey(key: string): Promise<{ ok: boolean; error?: string; models?: string[] }>
  hasApiKey(): Promise<boolean>
  listModels(): Promise<{ ok: true; models: string[] } | { ok: false; error: string }>
  deleteApiKey(): Promise<void>
  openConsole(): Promise<void>
  getLog(limit: number): Promise<LogRow[]>
  onEscalate(cb: (m: { chatId: string; text: string | null }) => void): () => void
  getBrand(): Promise<BrandSnapshot>
  saveBrandDraft(p: unknown): Promise<{ ok: boolean; issues: Issue[] }>
  applyBrand(): Promise<{ ok: boolean; issues: Issue[]; version?: number }>
  listBrandVersions(): Promise<{ version: number; createdAt: number }[]>
  restoreBrandVersion(v: number): Promise<{ ok: boolean; error?: string }>
  exportBrand(): Promise<string>
  importBrand(json: string): Promise<{ ok: boolean; issues: Issue[] }>
  previewChat(input: { draft: boolean; messages: string[] }): Promise<PreviewChatResult>
  listPresets(): Promise<{ id: string; label: string }[]>
  loadPreset(id: string): Promise<{ ok: boolean; issues: Issue[]; error?: string }>
  getDashboard(): Promise<DashboardData>
  bcOverview(): Promise<OverviewView>
  bcContacts(filter?: { status?: ContactStatus }): Promise<BContact[]>
  bcAudienceContacts(audience: 'chat' | 'impor' | 'semua'): Promise<BContact[]>
  bcSuppressed(): Promise<{ number: string | null; jid: string | null; reason: SuppressReason; at: number }[]>
  bcImportPreview(file: { name: string; data: string | Uint8Array }): Promise<ImportPreviewView>
  bcImportCommit(previewId: string, attest: { accepted: boolean; sourceNote: string }): Promise<{ importId: number; added: number; notOnWhatsApp: number; blockedBySuppression: number; aborted: boolean }>
  bcSendConfirmations(): Promise<{ ok: true; campaignId: number } | { ok: false; error: string }>
  bcSetWarmup(enabled: boolean): Promise<{ ok: true; enabled: boolean } | { ok: false; error: string }>
  bcCampaigns(): Promise<CampaignView[]>
  bcCreateCampaign(input: { name: string; template: string; audience: 'chat' | 'impor' | 'semua'; contactIds?: number[] | null }): Promise<{ ok: true; campaign: Campaign; warnings: string[]; samples: string[] } | { ok: false; errors: string[]; warnings: string[] }>
  bcPreviewCampaign(id: number): Promise<{ eligible: number; skipped: Record<string, number>; estimatedDays: number }>
  bcStartCampaign(id: number, confirmText?: string): Promise<{ ok: true } | { ok: false; error: string }>
  bcPauseCampaign(id: number): Promise<void>
  bcResumeCampaign(id: number): Promise<{ ok: true } | { ok: false; error: string }>
  bcStopCampaign(id: number): Promise<void>
  bcDiscardDraft(id: number): Promise<{ ok: boolean }>
  bcStopAll(): Promise<void>
  bcGetSafety(): Promise<SafetyView>
  bcSetSafety(patch: Record<string, unknown>): Promise<{ ok: true; safety: SafetyView } | { ok: false; error: string }>
  bcReport(id: number): Promise<ReportView>
  bcExportReport(id: number): Promise<string>
  bcEraseContact(id: number): Promise<void>
  bcAddContact(input: { name: string; number: string; accepted: boolean; sourceNote: string }): Promise<
    { ok: true; added: number; notOnWhatsApp: number; blockedBySuppression: number } | { ok: false; error: string }>
  onBroadcast(cb: (e: BroadcastEvent) => void): () => void
  memGet(chatId: string): Promise<{ summary: string; facts: Record<string, string> }>
  memUpdate(chatId: string, patch: { summary?: string; facts?: Record<string, string> }): Promise<void>
  memForget(chatId: string): Promise<void>
  listChats(): Promise<ChatSummary[]>
  getHandling(chatId: string): Promise<Handling>
  takeOverChat(chatId: string): Promise<void>
  handBackChat(chatId: string): Promise<void>
  /** Takes over or hands back many chats at once; returns how many were changed (groups are skipped). */
  setHandlingBulk(chatIds: string[], to: 'manusia' | 'bot'): Promise<{ changed: number }>
  sendAsAdmin(chatId: string, text: string): Promise<{ ok: true } | { ok: false; error: string }>
  getThread(chatId: string): Promise<FeedMessage[]>
  onMessage(cb: (m: FeedMessage) => void): () => void
  onAuthLocked(cb: () => void): () => void
  authState(): Promise<AuthState>
  authLogin(username: string, password: string): Promise<AuthResult>
  authLock(): Promise<void>
  authSetup(username: string, password: string): Promise<{ ok: true; recoveryCode: string } | { ok: false; error: 'invalid' }>
  authChangePassword(oldPassword: string, newPassword: string): Promise<AuthResult>
  authReset(recoveryCode: string, newPassword: string): Promise<AuthResult & { recoveryCode?: string }>
  authDisable(password: string): Promise<AuthResult>
  authSetAutoLock(min: number): Promise<void>
  onHandoff(cb: (e: { chatId: string; reason: string; summary: string }) => void): () => void
}

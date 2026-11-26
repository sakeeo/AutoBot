import { z } from 'zod'
import { PROVIDER_IDS } from './providers'
import type { BrandProfile, Issue } from './brand'
import type { Answer, ConnStatus, Decision, Settings } from './types'
import type { AddSourceInput, GsCredentialStatus, GsInspectResult, GsPreviewResult, GsSaveCredentialResult, GsSource, GsSyncEvent, PreviewInput, UpdateSourceInput } from './sheets'

export { CHANNELS } from './channels'

export const SettingsPatchSchema = z
  .object({
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
    theme: z.enum(['light', 'dark', 'auto']),
    notifyIncoming: z.boolean(),
    memoryEnabled: z.boolean()
  })
  .partial()
  .strict()

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
/** Earlier turns of a test chat, so the preview answers like the next message of the same conversation. */
export const TestHistorySchema = z.array(z.object({ role: z.enum(['user', 'bot']), text: z.string().trim().min(1).max(4000) }).strict()).max(40).default([])
export type TestHistory = z.infer<typeof TestHistorySchema>
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
  /** Digits of the number the bot is linked to, or null while disconnected. */
  getSelfNumber(): Promise<string | null>
  getSettings(): Promise<Settings>
  updateSettings(patch: unknown): Promise<Settings>
  listFiles(): Promise<FileInfo[]>
  reindex(): Promise<void>
  /** Deletes an indexed knowledge file (named relative to the knowledge folder) from disk and the index. */
  kbDelete(file: string): Promise<{ ok: boolean }>
  onIndexStatus(cb: (e: IndexStatusEvent) => void): () => void
  testQuestion(q: string, history?: { role: 'user' | 'bot'; text: string }[]): Promise<TestResult>
  saveApiKey(key: string): Promise<{ ok: boolean; error?: string; models?: string[] }>
  hasApiKey(): Promise<boolean>
  listModels(): Promise<{ ok: true; models: string[] } | { ok: false; error: string }>
  deleteApiKey(): Promise<void>
  /** Where the owner can create an API key for the selected provider, or null. */
  consoleUrl(): Promise<string | null>
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
  memGet(chatId: string): Promise<{ summary: string; facts: Record<string, string> }>
  memUpdate(chatId: string, patch: { summary?: string; facts?: Record<string, string> }): Promise<void>
  memForget(chatId: string): Promise<void>
  /** Erases the conversation, log, handling state and memory of one customer (both phone and lid jids). */
  eraseCustomer(chatId: string): Promise<{ removed: number }>
  /** The bot answers customers only while this is on. It is off until the owner switches it on. */
  getBotEnabled(): Promise<boolean>
  setBotEnabled(enabled: boolean): Promise<boolean>
  listChats(): Promise<ChatSummary[]>
  getHandling(chatId: string): Promise<Handling>
  takeOverChat(chatId: string): Promise<void>
  handBackChat(chatId: string): Promise<void>
  /** Takes over or hands back many chats at once; returns how many were changed (groups are skipped). */
  setHandlingBulk(chatIds: string[], to: 'manusia' | 'bot'): Promise<{ changed: number }>
  sendAsAdmin(chatId: string, text: string): Promise<{ ok: true } | { ok: false; error: string }>
  getThread(chatId: string): Promise<FeedMessage[]>
  onMessage(cb: (m: FeedMessage) => void): () => void
  onHandoff(cb: (e: { chatId: string; reason: string; summary: string }) => void): () => void
  // Google Sheets connector (owner only)
  gsCredentialStatus(): Promise<GsCredentialStatus>
  gsSaveCredential(json: string): Promise<GsSaveCredentialResult>
  gsDeleteCredential(): Promise<{ ok: true }>
  gsInspect(urlOrId: string): Promise<GsInspectResult>
  gsPreview(input: PreviewInput): Promise<GsPreviewResult>
  gsListSources(): Promise<GsSource[]>
  gsAddSource(input: AddSourceInput): Promise<{ id: string }>
  gsUpdateSource(id: string, patch: UpdateSourceInput): Promise<GsSource>
  gsRemoveSource(id: string): Promise<{ ok: true }>
  gsSyncNow(id: string): Promise<{ started: true }>
  gsConfirmChange(id: string): Promise<{ ok: true }>
  gsDismissChange(id: string): Promise<{ ok: true }>
  gsApproveDomain(domain: string): Promise<{ ok: true }>
  gsListApprovedDomains(): Promise<string[]>
  onKnowledgeSync(cb: (e: GsSyncEvent) => void): () => void
}

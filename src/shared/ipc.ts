import { z } from 'zod'
import { PROVIDER_IDS } from './providers'
import type { BrandProfile, Issue } from './brand'
import type { Answer, ConnStatus, Decision, Settings } from './types'

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
    theme: z.enum(['light', 'dark', 'auto'])
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
export const QuestionSchema = z.string().trim().min(1).max(2000)
export const LimitSchema = z.number().int().min(1).max(500)

export interface DashboardPeriod { replied: number; refused: number; handoff: number; errors: number; links: number }
export interface DashboardData {
  today: DashboardPeriod
  week: DashboardPeriod
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
export interface ChatSummary { chatId: string; isGroup: boolean; last: FeedMessage; count: number }

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
  getSettings(): Promise<Settings>
  updateSettings(patch: unknown): Promise<Settings>
  pickFolder(): Promise<string | null>
  listFiles(): Promise<FileInfo[]>
  reindex(): Promise<void>
  onIndexStatus(cb: (e: IndexStatusEvent) => void): () => void
  testQuestion(q: string): Promise<TestResult>
  saveApiKey(key: string): Promise<{ ok: boolean; error?: string }>
  hasApiKey(): Promise<boolean>
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
  listChats(): Promise<ChatSummary[]>
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

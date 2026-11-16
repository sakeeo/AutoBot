import { z } from 'zod'
import { PROVIDER_IDS } from './providers'
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

export const ApiKeySchema = z.string().trim().min(10).max(500)
export const QuestionSchema = z.string().trim().min(1).max(2000)
export const LimitSchema = z.number().int().min(1).max(500)

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
export interface TestResult {
  decision: Decision
  answer: Answer | null
  via: 'extractive' | 'ai' | null
}

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
}

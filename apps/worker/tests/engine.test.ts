import { afterEach, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import pino from 'pino'
import { CHANNELS } from '@autobot/contracts/channels'
import { secretNameFor } from '@autobot/contracts/providers'
import { createEngine, type Engine } from '../src/engine'
import { FakeGateway, incoming } from './helpers/fake-gateway'
import { makeDir } from './helpers/fixtures'

const open: Engine[] = []
afterEach(async () => { for (const e of open.splice(0)) await e.shutdown().catch(() => undefined) })

async function boot(opts: { dataDir?: string; key?: Buffer; gateway?: FakeGateway } = {}) {
  const dataDir = opts.dataDir ?? makeDir('wa-eng-')
  const gateway = opts.gateway ?? new FakeGateway()
  const engine = await createEngine({
    dataDir, secretKey: opts.key ?? randomBytes(32), gateway, logger: pino({ level: 'silent' })
  })
  open.push(engine)
  await engine.ready
  return { engine, gateway, dataDir }
}
const settle = () => new Promise((r) => setTimeout(r, 20))

describe('createEngine', () => {
  it('boots headless and answers the RPC methods the browser needs', async () => {
    const { engine } = await boot()
    const settings = (await engine.rpc.getSettings()) as Record<string, unknown>
    expect(settings.mode).toBe('extractive')
    // desktop-only settings are gone: the browser can no longer point the indexer at a server path
    for (const k of ['knowledgeFolders', 'excludePatterns', 'autoStart']) expect(settings, k).not.toHaveProperty(k)
    expect(engine.health()).toMatchObject({ ok: true, wa: 'disconnected', botEnabled: false })
  })

  it('exposes exactly the contract: every command channel is a method, and nothing from the desktop or the old login', async () => {
    const { engine } = await boot()
    const commands = Object.keys(CHANNELS).filter((k) => !k.startsWith('evt'))
    expect(Object.keys(engine.rpc).sort()).toEqual(commands.sort())
    for (const gone of ['pickFolder', 'kbUpload', 'authLogin', 'winClose', 'openConsole', 'bcOverview'])
      expect(engine.rpc).not.toHaveProperty(gone)
  })

  it('does not answer customers until the owner switches the bot on, then answers from an uploaded document', async () => {
    const { engine, gateway } = await boot()
    const up = await engine.uploadKnowledge([{ name: 'faq.md', data: Buffer.from('Harga kopi susu Rp25.000 per gelas') }])
    expect(up).toEqual({ added: ['faq.md'], rejected: [] })

    gateway.emitMessage(incoming({ id: 'a1' }))
    await settle()
    expect(gateway.sent).toHaveLength(0) // bot is off by default

    expect(await engine.rpc.setBotEnabled(true)).toBe(true)
    gateway.emitMessage(incoming({ id: 'a2' }))
    await settle()
    // replies are paced like a human typing, so allow time for the reply
    for (let i = 0; i < 200 && gateway.sent.length === 0; i++) await new Promise((r) => setTimeout(r, 50))
    expect(gateway.sent[0]?.text).toContain('Rp25.000')
  }, 20000)

  it('refuses anything but a real boolean for the bot switch', async () => {
    const { engine } = await boot()
    expect(() => engine.rpc.setBotEnabled('true')).toThrow()
    expect(await engine.rpc.getBotEnabled()).toBe(false)
  })

  it('lists knowledge files by name only, never by absolute path, and deletes through the name', async () => {
    const { engine, dataDir } = await boot()
    await engine.uploadKnowledge([{ name: 'a.md', data: Buffer.from('Jam buka 08.00') }])
    const list = (await engine.rpc.listFiles()) as { file: string }[]
    expect(list.map((f) => f.file)).toEqual(['a.md'])
    expect(JSON.stringify(list)).not.toContain(dataDir)
    expect(engine.knowledgeFilePath('a.md')).toBe(join(dataDir, 'knowledge', 'a.md'))
    expect(await engine.rpc.kbDelete('a.md')).toEqual({ ok: true })
    expect(existsSync(join(dataDir, 'knowledge', 'a.md'))).toBe(false)
    expect(await engine.rpc.listFiles()).toEqual([])
  })

  it('will not hand out or delete a file outside the knowledge folder or one the index does not know', async () => {
    const { engine, dataDir } = await boot()
    for (const bad of ['../autobot.db', '../../etc/passwd', '/etc/passwd', 'tidak-ada.md', '..', ''])
      expect(() => engine.knowledgeFilePath(bad), bad).toThrow()
    await expect(Promise.resolve().then(() => engine.rpc.kbDelete('../settings.json'))).rejects.toThrow()
    expect(readdirSync(dataDir)).toContain('autobot.db')
  })

  it('keeps API keys encrypted on disk and unreadable with another key', async () => {
    const dir = makeDir('wa-eng-')
    const key = randomBytes(32)
    const a = await boot({ dataDir: dir, key })
    a.engine.internals.secrets.set(secretNameFor('claude'), 'sk-ant-TOPSECRETVALUE')
    expect(readFileSync(join(dir, 'secrets.json'), 'utf8')).not.toContain('TOPSECRETVALUE')
    expect(await a.engine.rpc.hasApiKey()).toBe(true)
    await a.engine.shutdown()
    const b = await boot({ dataDir: dir, key: randomBytes(32) })
    expect(b.engine.internals.secrets.get(secretNameFor('claude'))).toBeNull()
  })

  it('forwards gateway status and feed events under the contract channel names', async () => {
    const { engine, gateway } = await boot()
    const seen: [string, unknown][] = []
    for (const ch of [CHANNELS.evtStatus, CHANNELS.evtMessage]) engine.events.on(ch, (p) => seen.push([ch, p]))
    gateway.emitStatus({ state: 'waiting_qr', qr: 'QR-DATA' })
    gateway.emitMessage(incoming({ id: 'e1' }))
    await settle()
    expect(seen.find(([c]) => c === CHANNELS.evtStatus)?.[1]).toEqual({ state: 'waiting_qr', qr: 'QR-DATA' })
    expect(seen.find(([c]) => c === CHANNELS.evtMessage)?.[1]).toMatchObject({ chatId: '6281@s.whatsapp.net', direction: 'in' })
    expect(engine.health().wa).toBe('waiting_qr')
  })

  it('only one engine may run on a data folder, and the folder is free again after shutdown', async () => {
    const dir = makeDir('wa-eng-')
    const first = await boot({ dataDir: dir })
    await expect(boot({ dataDir: dir })).rejects.toThrow('INSTANCE_ALREADY_RUNNING')
    await first.engine.shutdown()
    expect(first.gateway.stopped).toBe(true)
    await expect(boot({ dataDir: dir })).resolves.toBeDefined()
  })

  it('systemSend leaves no trace of the code: not in the feed, turns, log, memory, or after the echo comes back', async () => {
    const { engine, gateway } = await boot()
    const owner = '6281234567890'
    gateway.emitStatus({ state: 'connected' })
    gateway.onSend = async (_chat, _text) => {
      // WhatsApp echoes our own message back with the same id as the one being sent
      gateway.emitMessage(incoming({ id: `m-${gateway.sent.length + 1}`, chatId: `${owner}@s.whatsapp.net`, sender: gateway.self!, fromMe: true, text: 'echo' }))
    }
    expect(await engine.systemSend({ to: owner, kind: 'otp_setup', code: '731946' })).toEqual({ ok: true })
    await settle()
    expect(gateway.sent[0].text).toContain('731946')
    const { db } = engine.internals
    for (const table of ['messages', 'message_log', 'turns', 'contact_memory', 'events', 'handoffs', 'contacts', 'system_send_log'])
      expect(JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all()), table).not.toContain('731946')
    expect(engine.internals.conv.getState(`${owner}@s.whatsapp.net`).status).toBe('bot') // the echo did not pause the bot
    expect(await engine.rpc.listChats()).toEqual([])
  })

  it('systemSend refuses while WhatsApp is not connected', async () => {
    const { engine } = await boot()
    expect(await engine.systemSend({ to: '6281234567890', kind: 'otp_setup', code: '123456' })).toEqual({ ok: false, code: 'WA_DISCONNECTED' })
  })

  it('erases a customer through the RPC and refuses WhatsApp status lists', async () => {
    const { engine, gateway } = await boot()
    await engine.rpc.setBotEnabled(true)
    gateway.emitMessage(incoming({ id: 'x1', text: 'halo, nomor saya rahasia' }))
    await settle()
    expect(await engine.rpc.listChats()).toHaveLength(1)
    expect((await engine.rpc.eraseCustomer('6281@s.whatsapp.net')) as { removed: number }).toMatchObject({ removed: expect.any(Number) })
    expect(await engine.rpc.listChats()).toEqual([])
    expect(() => engine.rpc.eraseCustomer('status@broadcast')).toThrow()
  })
})

describe('chat info for the Pesan page', () => {
  it('tells why a chat was handed over, with the lead and stage, and forgets the reason once taken over', async () => {
    const { engine } = await boot()
    const db = engine.internals.db
    const id = '6281@s.whatsapp.net'
    db.prepare("INSERT INTO contacts(chat_id, status, stage, lead_json) VALUES (?, 'menunggu_admin', 'penawaran', '{\"kebutuhan\":\"landing page\"}')").run(id)
    db.prepare("INSERT INTO handoffs(chat_id, reason, status, created_at) VALUES (?, 'minta nego harga', 'open', 1)").run(id)
    expect(await engine.rpc.getChatInfo(id)).toMatchObject({ handling: 'menunggu_admin', handoffReason: 'minta nego harga', stage: 'penawaran', lead: { kebutuhan: 'landing page' }, product: null })
    await engine.rpc.takeOverChat(id)
    expect(await engine.rpc.getChatInfo(id)).toMatchObject({ handling: 'manusia', handoffReason: null })
    expect(() => engine.rpc.getChatInfo('')).toThrow()
  })
})

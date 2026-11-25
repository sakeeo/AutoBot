import type { WaGateway } from '../../src/wa/gateway'
import type { ConnStatus, IncomingMessage } from '@autobot/contracts/types'

/** A WhatsApp gateway that talks to nobody: tests drive it and read what the bot sent. */
export class FakeGateway implements WaGateway {
  sent: { chatId: string; text: string }[] = []
  self: string | null = '6285119308345'
  /** Numbers that exist on WhatsApp; empty means every number exists. */
  registered: Set<string> | null = null
  failSend = false
  /** Runs inside sendText before the message counts as sent (to simulate the echo arriving mid-send). */
  onSend: ((chatId: string, text: string) => Promise<void>) | null = null
  stopped = false
  private msgCbs: ((m: IncomingMessage) => void)[] = []
  private statusCbs: ((s: ConnStatus) => void)[] = []

  onMessage(cb: (m: IncomingMessage) => void): void { this.msgCbs.push(cb) }
  onStatus(cb: (s: ConnStatus) => void): void { this.statusCbs.push(cb) }
  emitMessage(m: IncomingMessage): void { for (const cb of this.msgCbs) cb(m) }
  emitStatus(s: ConnStatus): void { for (const cb of this.statusCbs) cb(s) }
  async connect(): Promise<void> { this.emitStatus({ state: 'connected' }) }
  async logout(): Promise<void> {}
  async stop(): Promise<void> { this.stopped = true }
  selfNumber(): string | null { return this.self }
  async onWhatsApp(numbers: string[]) {
    return numbers.map((number) => {
      const exists = !this.registered || this.registered.has(number)
      return { number, jid: exists ? `${number}@s.whatsapp.net` : null, exists }
    })
  }
  jidFor(number: string): string { return `${number.replace(/\D/g, '')}@s.whatsapp.net` }
  async sendText(chatId: string, text: string): Promise<string | null> {
    if (this.failSend) throw new Error('send failed')
    if (this.onSend) await this.onSend(chatId, text)
    this.sent.push({ chatId, text })
    return `m-${this.sent.length}`
  }
}

let n = 0
export const incoming = (o: Partial<IncomingMessage> = {}): IncomingMessage => ({
  id: `in-${++n}`, chatId: '6281@s.whatsapp.net', sender: '6281@s.whatsapp.net', isGroup: false, fromMe: false,
  text: 'berapa harga kopi?', timestamp: Date.now(), ...o
})

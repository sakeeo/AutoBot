import { describe, it, expect } from 'vitest'
import { STOP_CONFIRMATION, START_CONFIRMATION, classifyReply } from '../../src/main/broadcast/optout'

describe('classifyReply', () => {
  it.each(['BERHENTI', 'stop.', 'Stop!!', '  berhenti  ', 'Unsubscribe', 'batal langganan', 'Jangan kirim lagi', 'hapus nomor saya', 'stop dong', 'berhenti ya'])(
    '"%s" is a request to stop', (t) => expect(classifyReply(t)).toBe('stop')
  )
  it.each(['mulai', 'MULAI', 'Start', 'mulai lagi'])('"%s" is a request to start again', (t) => expect(classifyReply(t)).toBe('start'))
  it.each(['spam', 'ini spam!', 'saya laporkan ya', 'penipu', 'apakah ini penipuan'])('"%s" is a complaint', (t) =>
    expect(classifyReply(t)).toBe('complaint')
  )
  it.each([
    'jangan stop dulu ya', 'berhenti di jalan?', 'aku mau stop kontrak minggu depan', 'start up saya',
    'stop ' + 'x'.repeat(60), 'berapa harga?', '', '   ', 'halo', 'saya mau mulai pesan website'
  ])('"%s" is ordinary chat', (t) => expect(classifyReply(t)).toBeNull())
  it('ships clear confirmation texts', () => {
    expect(STOP_CONFIRMATION).toMatch(/tidak akan menerima/i)
    expect(STOP_CONFIRMATION).toMatch(/MULAI/)
    expect(START_CONFIRMATION).toMatch(/berlangganan/i)
  })
})

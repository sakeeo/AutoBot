import { describe, it, expect } from 'vitest'
import { OPTOUT_FOOTER, lintMessage, renderTemplate, withFooter } from '../../src/main/broadcast/lint'

const ctx = { businessName: 'Kopi Sudut' }
const good = 'Halo Kak, Kopi Sudut punya menu baru minggu ini. Mampir ya.'

describe('renderTemplate', () => {
  it('fills known variables and blanks unknown ones without leaving braces or double spaces', () => {
    expect(renderTemplate('Halo {nama}, ini {bisnis}.', { nama: 'Budi', bisnis: 'Kopi Sudut' })).toBe('Halo Budi, ini Kopi Sudut.')
    expect(renderTemplate('Halo {nama}, ini {bisnis} {paket}', { bisnis: 'Kopi Sudut' })).toBe('Halo , ini Kopi Sudut')
    expect(renderTemplate('Paket {paket}', { bisnis: 'X', paket: 'Gold' })).toBe('Paket Gold')
  })
})

describe('withFooter', () => {
  it('always ends with the opt-out sentence, exactly once', () => {
    const once = withFooter(good)
    expect(once.endsWith(OPTOUT_FOOTER)).toBe(true)
    expect(withFooter(once)).toBe(once)
    expect(once.split(OPTOUT_FOOTER)).toHaveLength(2)
  })
  it('cannot be hidden by putting the sentence in the middle of the text', () => {
    const sneaky = `${OPTOUT_FOOTER} Promo besar hari ini!`
    expect(withFooter(sneaky).endsWith(OPTOUT_FOOTER)).toBe(true)
  })
})

describe('lintMessage', () => {
  it('accepts a healthy message with neither errors nor warnings', () => {
    expect(lintMessage(good, ctx)).toEqual({ errors: [], warnings: [] })
  })
  it('accepts {bisnis} as the business name', () => {
    expect(lintMessage('Halo Kak, ini {bisnis} dengan kabar baru.', ctx).errors).toEqual([])
  })
  it('errors when the business is not named', () => {
    expect(lintMessage('Halo Kak, ada promo besar minggu ini.', ctx).errors.join(' ')).toMatch(/nama bisnis/i)
  })
  it('errors above 600 characters', () => {
    expect(lintMessage(good + ' x'.repeat(400), ctx).errors.join(' ')).toMatch(/600/)
  })
  it('errors on more than one link and on link shorteners', () => {
    expect(lintMessage(`${good} https://a.id https://b.id`, ctx).errors.join(' ')).toMatch(/satu tautan/i)
    for (const u of ['https://bit.ly/abc', 'https://tinyurl.com/x', 'http://t.co/y', 'https://s.id/z'])
      expect(lintMessage(`${good} ${u}`, ctx).errors.join(' '), u).toMatch(/pemendek/i)
    expect(lintMessage(`${good} https://kopisudut.id/menu`, ctx).errors).toEqual([])
  })
  it('warns about shouting and about repeating the last campaign verbatim', () => {
    expect(lintMessage('PROMO BESAR KOPI SUDUT HARI INI SAJA JANGAN LEWATKAN', ctx).warnings.join(' ')).toMatch(/huruf kapital/i)
    expect(lintMessage(good, { ...ctx, lastCampaignText: good }).warnings.join(' ')).toMatch(/sama/i)
  })
})

import { describe, expect, it } from 'vitest'
import { csvToObjects, parseCsvRows } from '../src/knowledge/tabular'

describe('csv parser', () => {
  it('handles quotes, commas, CRLF, BOM and blank lines', () => {
    const rows = parseCsvRows('﻿id,nama\r\n1,"Kopi, besar"\r\n\r\n2,"Teh ""manis"""\r\n')
    expect(rows).toEqual([['id', 'nama'], ['1', 'Kopi, besar'], ['2', 'Teh "manis"']])
  })
  it('maps rows to header keys and keeps empty cells as empty strings', () => {
    expect(csvToObjects('a,b\n1,\n')).toEqual([{ a: '1', b: '' }])
  })
})

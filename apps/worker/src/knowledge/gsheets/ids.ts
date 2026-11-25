const ID = /^[A-Za-z0-9_-]{10,100}$/
const URL_RE = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{10,100})(?:[/?#]|$)/

/**
 * Pulls the spreadsheet id out of a Google Sheets address or a bare id. The address itself is never fetched: only the id
 * is used, to build a request to sheets.googleapis.com, so a pasted address cannot make the server call another host.
 */
export function parseSpreadsheetRef(input: string): string | null {
  const t = input.trim()
  const m = URL_RE.exec(t)
  if (m) return m[1]
  return ID.test(t) ? t : null
}

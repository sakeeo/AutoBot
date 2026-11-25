import { GS_MESSAGES as MESSAGES, type GsError } from '@autobot/contracts/sheets'

/** A failure the owner can act on. The message is plain Indonesian; it never carries a key, a token or a response body. */
export class GsFailure extends Error {
  constructor(readonly code: GsError, message?: string, readonly clientEmail?: string) {
    super(message ?? MESSAGES[code])
    this.name = 'GsFailure'
  }
}

export { MESSAGES }

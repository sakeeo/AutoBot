/**
 * An error whose message is meant for the person using the app (Indonesian text, no paths, no SQL).
 * Only these are passed on to the browser; anything else is logged on the server and shown as a generic failure.
 */
export class UserError extends Error {
  constructor(message: string, readonly code: 'REJECTED' | 'NOT_FOUND' | 'CONFLICT' = 'REJECTED') {
    super(message)
    this.name = 'UserError'
  }
}

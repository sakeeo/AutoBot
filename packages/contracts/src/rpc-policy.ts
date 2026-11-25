import { CHANNELS } from './channels'

/**
 * Who may call which RPC method. The web app checks this table on every request; a method that is not listed here is
 * refused, so adding a method to the worker never exposes it by accident.
 *
 *  - owner: the signed-in owner (password + TOTP).
 *  - setup: the temporary principal of the first-run wizard (holds the setup token, no account yet).
 */
export type Principal = 'owner' | 'setup'

type MethodName = Exclude<keyof typeof CHANNELS, `evt${string}`>

/** Methods the setup wizard may call: just enough to link WhatsApp and see the connection state. */
const SETUP_METHODS: ReadonlySet<string> = new Set(['getStatus', 'getSelfNumber', 'connect', 'logout'])

/** Every method the owner may call. */
const OWNER_METHODS = Object.keys(CHANNELS).filter((k) => !k.startsWith('evt')) as MethodName[]

/**
 * Methods that need the owner to have re-entered the password in the last ten minutes: they change what the bot is
 * connected to, or erase or switch things that are hard to undo.
 */
export const STEP_UP_METHODS: ReadonlySet<string> = new Set([
  'saveApiKey', 'deleteApiKey', 'connect', 'logout', 'eraseCustomer', 'setBotEnabled',
  'gsSaveCredential', 'gsDeleteCredential', 'gsRemoveSource', 'gsApproveDomain'
])

export const REAUTH_WINDOW_MS = 10 * 60_000

export function allowedFor(method: string, who: Principal): boolean {
  if (who === 'setup') return SETUP_METHODS.has(method)
  return (OWNER_METHODS as string[]).includes(method)
}

/** Events each principal may receive over the event stream. */
export const SETUP_EVENTS: ReadonlySet<string> = new Set([CHANNELS.evtStatus])

/**
 * Methods the browser calls on a timer to keep the screen current. They do not count as the owner being active, so an
 * open tab that nobody touches still signs out after the idle limit.
 */
export const BACKGROUND_METHODS: ReadonlySet<string> = new Set(['getStatus', 'getSelfNumber', 'getDashboard', 'getBotEnabled'])

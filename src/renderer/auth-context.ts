import { createContext, useContext } from 'react'
import type { AuthState } from '../shared/ipc'

export interface AuthCtx { state: AuthState; refresh(): Promise<void> }

export const AuthContext = createContext<AuthCtx>({
  state: { enabled: false, locked: false, username: null, autoLockMin: 0 },
  refresh: async () => undefined
})
export const useAuth = (): AuthCtx => useContext(AuthContext)

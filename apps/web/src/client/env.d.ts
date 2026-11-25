import type { WebApi } from './api-client'

declare global {
  interface Window {
    api: WebApi
  }
}
export {}

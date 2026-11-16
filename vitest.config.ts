import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: { environment: 'node', include: ['tests/**/*.test.{ts,tsx}'], pool: 'forks' }
})

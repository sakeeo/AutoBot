import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['apps/*/tests/**/*.test.{ts,tsx}', 'packages/*/tests/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    pool: 'forks'
  }
})

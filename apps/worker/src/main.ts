import pino from 'pino'
import { loadConfig } from './config'
import { createEngine } from './engine'
import { httpDateProbe } from './clock-monitor'
import { createWorkerServer } from './server'

async function main(): Promise<void> {
  const logger = pino({
    level: process.env.LOG_LEVEL ?? 'info',
    redact: { paths: ['otp', 'code', 'text', 'password', 'apiKey', 'secret', 'token', '*.otp', '*.code', '*.text', '*.password', '*.apiKey', '*.secret', '*.token'], censor: '[redacted]' }
  })
  let cfg
  try {
    cfg = loadConfig()
  } catch (e) {
    logger.fatal((e as Error).message)
    process.exit(1)
  }
  const engine = await createEngine({ dataDir: cfg.dataDir, secretKey: cfg.secretKey, logger, timeProbe: httpDateProbe() })
  const server = createWorkerServer(engine, { token: cfg.token, logger })
  server.listen(cfg.port, cfg.host, () => logger.info({ port: cfg.port }, 'worker listening'))

  let stopping = false
  const stop = async (signal: string): Promise<void> => {
    if (stopping) return
    stopping = true
    logger.info({ signal }, 'shutting down')
    server.closeAllConnections()
    await new Promise<void>((r) => server.close(() => r()))
    await engine.shutdown()
    process.exit(0)
  }
  process.on('SIGTERM', () => void stop('SIGTERM'))
  process.on('SIGINT', () => void stop('SIGINT'))
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('worker failed to start:', e instanceof Error ? e.message : e)
  process.exit(1)
})

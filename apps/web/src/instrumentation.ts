export async function register(): Promise<void> {
  // Next calls this in every runtime; the database and native modules exist only in Node.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { startup } = await import('./server/startup')
  await startup()
}

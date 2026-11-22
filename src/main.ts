import { openDb } from './db.ts'
import { dbPath, port, supportedChainIds } from './config.ts'
import { createApp } from './server.ts'
import { startWatcher } from './watcher.ts'

const db = openDb(dbPath)
const app = createApp(db)
const stopWatcher = startWatcher(db)

app.listen(port, () => {
  console.log(`Executor слушает :${port}`)
  console.log(`база: ${dbPath}`)
  console.log(`сети: ${supportedChainIds.join(', ')}`)
  console.log('аутентификации нет — см. 7.2 executor-stage-1.md')
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopWatcher()
    app.close(() => {
      db.close()
      process.exit(0)
    })
  })
}

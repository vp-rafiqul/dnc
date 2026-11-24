import { config } from "./config.ts"
import { createApp } from "./app.ts"
import { createDatabase } from "./db/prisma.ts"

const settings = config()
const db = createDatabase(settings.databaseUrl)
const server = createApp(db, settings).listen(settings.port, settings.host, async (error?: NodeJS.ErrnoException) => {
  if (error) {
    const address = `${settings.host}:${settings.port}`
    const message = error.code === "EADDRINUSE"
      ? `Port ${address} is already in use. Stop the existing server or update PORT in backend/.env and API_ENDPOINT in frontend/.env.`
      : `DNC API could not listen on ${address}: ${error.message}`
    console.error(message)
    process.exitCode = 1
    await db.$disconnect()
    return
  }
  console.log(`DNC API listening on http://${settings.host}:${settings.port}`)
})

function shutdown() {
  server.close(() => void db.$disconnect())
}
process.once("SIGINT", shutdown)
process.once("SIGTERM", shutdown)

import { Pool } from "pg"
import { config } from "./config.ts"
import { createApp } from "./app.ts"

const settings = config()
const db = new Pool({ connectionString: settings.databaseUrl, connectionTimeoutMillis: 5000 })
db.on("error", (error: NodeJS.ErrnoException) => console.error("PostgreSQL connection error", error.code))
const server = createApp(db, settings).listen(settings.port, settings.host, async (error?: NodeJS.ErrnoException) => {
  if (error) {
    const address = `${settings.host}:${settings.port}`
    const message = error.code === "EADDRINUSE"
      ? `Port ${address} is already in use. Stop the existing server or update PORT in backend/.env and API_ENDPOINT in frontend/.env.`
      : `DNC API could not listen on ${address}: ${error.message}`
    console.error(message)
    process.exitCode = 1
    await db.end()
    return
  }
  console.log(`DNC API listening on http://${settings.host}:${settings.port}`)
})

function shutdown() {
  server.close(() => void db.end())
}
process.once("SIGINT", shutdown)
process.once("SIGTERM", shutdown)

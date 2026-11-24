import { existsSync } from "node:fs"
import { defineConfig } from "prisma/config"

const envFile = new URL("./.env", import.meta.url)
if (existsSync(envFile)) process.loadEnvFile(envFile)

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node --env-file-if-exists=.env src/db/seed.ts",
  },
  datasource: { url: process.env.DATABASE_URL },
})

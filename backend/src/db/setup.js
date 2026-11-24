import { readdir, readFile } from "node:fs/promises"
import { Pool } from "pg"
import { z } from "zod"
import { hashPassword } from "../modules/auth/auth.service.js"

const mode = process.argv[2] ?? "setup"
if (!["migrate", "seed", "setup"].includes(mode)) {
  throw new Error("Expected migrate, seed, or setup")
}

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error("Set DATABASE_URL in backend/.env")

async function migrate(client) {
  const directory = new URL("migrations/", import.meta.url)
  const files = (await readdir(directory)).filter(file => file.endsWith(".sql")).sort()
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`)
  const { rows } = await client.query("SELECT version FROM schema_migrations")
  const applied = new Set(rows.map(row => row.version))
  for (const file of files) {
    const version = file.slice(0, -4)
    if (applied.has(version)) continue
    await client.query(await readFile(new URL(file, directory), "utf8"))
    await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version])
  }
}

async function seed(client) {
  await client.query("INSERT INTO roles (name, is_super_admin) VALUES ('Super Admin', true) ON CONFLICT DO NOTHING")
  const { rows: [role] } = await client.query("SELECT id FROM roles WHERE is_super_admin")
  if (!role) throw new Error("The Super Admin role could not be seeded")

  const existing = await client.query("SELECT 1 FROM users WHERE role_id = $1 LIMIT 1", [role.id])
  if (!existing.rowCount) {
    const email = z.email().max(254).safeParse(process.env.ADMIN_EMAIL?.trim().toLowerCase())
    const password = process.env.ADMIN_PASSWORD
    if (!email.success || !password || password.length < 12 || password.length > 128) {
      throw new Error("Set a valid ADMIN_EMAIL and a 12–128 character ADMIN_PASSWORD in backend/.env")
    }
    await client.query("INSERT INTO users (name, email, password_hash, role_id) VALUES ($1, $2, $3, $4)",
      ["Workspace Admin", email.data, await hashPassword(password), role.id])
  }
  await client.query(await readFile(new URL("seed.sql", import.meta.url), "utf8"))
}

const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 })
try {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    await client.query("SELECT pg_advisory_xact_lock(807244)")
    if (mode !== "seed") await migrate(client)
    if (mode !== "migrate") await seed(client)
    await client.query("COMMIT")
    if (mode !== "seed") console.log("Database migrations are up to date.")
    if (mode !== "migrate") console.log("Super Admin and synthetic screening data are ready.")
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
} finally {
  await pool.end()
}

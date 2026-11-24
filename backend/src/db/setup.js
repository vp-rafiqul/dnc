import { readFile } from "node:fs/promises"
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
  const version = "001_initial"
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`)
  const applied = await client.query("SELECT 1 FROM schema_migrations WHERE version = $1", [version])
  if (applied.rowCount) return
  await client.query(await readFile(new URL("migrations/001_initial.sql", import.meta.url), "utf8"))
  await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version])
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
    if (mode !== "seed") console.log("Database migration 001_initial is up to date.")
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

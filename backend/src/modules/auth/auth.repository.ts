import type { Pool } from "pg"
import type { AccountPrincipalRow } from "./auth.service.ts"

const account = "SELECT u.*, r.name AS role, r.is_super_admin, r.is_reseller, r.permissions FROM users u JOIN roles r ON r.id = u.role_id"

interface Account extends AccountPrincipalRow {
  password_hash: string
  active: boolean
}

export function authRepository(db: Pool) {
  return {
    async findByEmail(email: string): Promise<Account | undefined> {
      return (await db.query<Account>(`${account} WHERE u.email = $1`, [email])).rows[0]
    },
    async createSession(id: string, userId: string, expiresAt: Date) {
      await db.query("DELETE FROM sessions WHERE expires_at <= now()")
      await db.query("INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)", [id, userId, expiresAt])
    },
    async findSession(id: string, userId: string): Promise<Account | undefined> {
      return (await db.query<Account>(`${account} JOIN sessions s ON s.user_id = u.id
        WHERE s.id = $1 AND u.id = $2 AND u.active AND s.expires_at > now()`, [id, userId])).rows[0]
    },
    async deleteSession(id: string) {
      await db.query("DELETE FROM sessions WHERE id = $1", [id])
    },
  }
}

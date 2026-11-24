const account = "SELECT u.*, r.name AS role, r.is_super_admin, r.permissions FROM users u JOIN roles r ON r.id = u.role_id"

export function authRepository(db) {
  return {
    async findByEmail(email) {
      return (await db.query(`${account} WHERE u.email = $1`, [email])).rows[0]
    },
    async createSession(id, userId, expiresAt) {
      await db.query("DELETE FROM sessions WHERE expires_at <= now()")
      await db.query("INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)", [id, userId, expiresAt])
    },
    async findSession(id, userId) {
      return (await db.query(`${account} JOIN sessions s ON s.user_id = u.id
        WHERE s.id = $1 AND u.id = $2 AND u.active AND s.expires_at > now()`, [id, userId])).rows[0]
    },
    async deleteSession(id) {
      await db.query("DELETE FROM sessions WHERE id = $1", [id])
    },
  }
}

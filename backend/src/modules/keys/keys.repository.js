export function keysRepository(db) {
  return {
    async list(userId) {
      return (await db.query(`SELECT id, name, prefix, created_at, revoked_at FROM api_keys
        WHERE user_id = $1 ORDER BY created_at DESC, id DESC`, [userId])).rows
    },
    async create(userId, name, prefix, hash) {
      return (await db.query(`INSERT INTO api_keys (user_id, name, prefix, secret_hash)
        VALUES ($1, $2, $3, $4) RETURNING id, name, prefix, created_at, revoked_at`, [userId, name, prefix, hash])).rows[0]
    },
    async revoke(userId, id) {
      return (await db.query(`UPDATE api_keys SET revoked_at = COALESCE(revoked_at, now())
        WHERE user_id = $1 AND id = $2 RETURNING id`, [userId, id])).rows[0]
    },
    async findOwner(hash) {
      return (await db.query(`SELECT u.id, u.name, u.email, r.name AS role, r.is_super_admin, r.permissions
        FROM api_keys k JOIN users u ON u.id = k.user_id JOIN roles r ON r.id = u.role_id
        WHERE k.secret_hash = $1 AND k.revoked_at IS NULL AND u.active`, [hash])).rows[0]
    },
  }
}

const userSelect = `SELECT u.id, u.name, u.email, u.active, u.role_id, r.name AS role, r.is_super_admin, r.permissions
  FROM users u JOIN roles r ON r.id = u.role_id`

export function accessRepository(db) {
  return {
    async listRoles() {
      return (await db.query("SELECT id, name, permissions, is_super_admin FROM roles ORDER BY is_super_admin DESC, name")).rows
    },
    async saveRole(id, name, permissions) {
      const result = id
        ? await db.query("UPDATE roles SET name = $2, permissions = $3 WHERE id = $1 AND NOT is_super_admin RETURNING id, name, permissions", [id, name, permissions])
        : await db.query("INSERT INTO roles (name, permissions) VALUES ($1, $2) RETURNING id, name, permissions", [name, permissions])
      return result.rows[0]
    },
    async listUsers() {
      return (await db.query(`${userSelect} ORDER BY u.created_at DESC, u.id`)).rows
    },
    async createUser(actorId, name, email, hashedPassword, roleId) {
      const { rows } = await db.query(`INSERT INTO users (name, email, password_hash, role_id)
        SELECT $2, $3, $4, target.id
        FROM users actor JOIN roles authority ON authority.id = actor.role_id
        JOIN roles target ON target.id = $5
        WHERE actor.id = $1 AND actor.active AND NOT target.is_super_admin
          AND (authority.is_super_admin OR (
            authority.permissions @> ARRAY['page.users', 'users.create'] AND authority.permissions @> target.permissions
          ))
        RETURNING id`, [actorId, name, email, hashedPassword, roleId])
      return rows[0]
    },
    async updateUser(actorId, id, roleId, active) {
      const { rows } = await db.query(`WITH modified AS (
        UPDATE users account SET role_id = target.id, active = $4
        FROM users actor JOIN roles authority ON authority.id = actor.role_id
        JOIN roles target ON target.id = $3, roles existing
        WHERE account.id = $2 AND actor.id = $1 AND account.id <> actor.id AND actor.active
          AND existing.id = account.role_id AND NOT existing.is_super_admin AND NOT target.is_super_admin
          AND (authority.is_super_admin OR (
            authority.permissions @> ARRAY['page.users', 'users.update']
            AND authority.permissions @> target.permissions AND authority.permissions @> existing.permissions
          ))
        RETURNING account.id
      ), invalidated AS (
        DELETE FROM sessions WHERE user_id IN (SELECT id FROM modified) AND NOT $4::boolean
      ), revoked AS (
        UPDATE api_keys SET revoked_at = now(), encrypted_secret = NULL
        WHERE user_id IN (SELECT id FROM modified) AND NOT $4::boolean AND revoked_at IS NULL
      )
      SELECT id FROM modified`, [actorId, id, roleId, active])
      return rows[0]
    },
  }
}

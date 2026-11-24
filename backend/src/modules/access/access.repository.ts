import type { Pool } from "pg"
import type { Permission, Principal, Role, WorkspaceUser } from "../../../../shared/contracts.ts"

type UserRow = Omit<WorkspaceUser, "manageable"> & { permissions: Permission[] }
type SavedRole = Pick<Role, "id" | "name" | "permissions" | "reseller_id">
type AccountId = Pick<Principal, "id">

const roleFields = "id, name, permissions, is_super_admin, is_reseller, reseller_id"
const visibleScope = `($2::boolean OR (
  CASE WHEN $3::boolean THEN r.reseller_id = $1
    ELSE r.reseller_id IS NULL AND NOT r.is_reseller
  END
))`

export function accessRepository(db: Pool) {
  return {
    async listRoles(actor: Principal) {
      return (await db.query<Role>(`SELECT r.*, owner.name AS reseller FROM roles r
        LEFT JOIN users owner ON owner.id = r.reseller_id
        WHERE ${visibleScope} ORDER BY r.is_super_admin DESC, r.is_reseller DESC, r.name, r.id`,
      [actor.id, actor.isSuperAdmin, actor.isReseller])).rows
    },
    async saveRole(actorId: string, id: string | null, name: string, permissions: Permission[], assignable: Permission[]): Promise<SavedRole | undefined> {
      const result = id
        ? await db.query<SavedRole>(`UPDATE roles target SET name = $3, permissions = $4
            FROM users actor JOIN roles authority ON authority.id = actor.role_id
            WHERE actor.id = $1 AND actor.active AND target.id = $2
              AND NOT target.is_super_admin AND NOT target.is_reseller
              AND (authority.is_super_admin OR (authority.is_reseller AND target.reseller_id = actor.id))
              AND (target.reseller_id IS NULL OR $4::text[] <@ $5::text[])
            RETURNING target.id, target.name, target.permissions, target.reseller_id`,
          [actorId, id, name, permissions, assignable])
        : await db.query<SavedRole>(`INSERT INTO roles (name, permissions, reseller_id)
            SELECT $2, $3, CASE WHEN authority.is_reseller THEN actor.id END
            FROM users actor JOIN roles authority ON authority.id = actor.role_id
            WHERE actor.id = $1 AND actor.active
              AND (authority.is_super_admin OR (authority.is_reseller AND $3::text[] <@ $4::text[]))
            RETURNING ${roleFields}`, [actorId, name, permissions, assignable])
      return result.rows[0]
    },
    async listUsers(actor: Principal) {
      return (await db.query<UserRow>(`SELECT u.id, u.name, u.email, u.active, u.role_id, r.name AS role,
          r.is_super_admin, r.is_reseller, r.permissions, r.reseller_id, owner.name AS reseller
        FROM users u JOIN roles r ON r.id = u.role_id
        LEFT JOIN users owner ON owner.id = r.reseller_id
        WHERE ${visibleScope} ORDER BY u.created_at DESC, u.id`,
      [actor.id, actor.isSuperAdmin, actor.isReseller])).rows
    },
    async createReseller(actorId: string, name: string, email: string, hashedPassword: string): Promise<AccountId | undefined> {
      const { rows } = await db.query<AccountId>(`INSERT INTO users (name, email, password_hash, role_id)
        SELECT $2, $3, $4, target.id
        FROM users actor JOIN roles authority ON authority.id = actor.role_id
        JOIN roles target ON target.is_reseller
        WHERE actor.id = $1 AND actor.active AND authority.is_super_admin
        RETURNING id`, [actorId, name, email, hashedPassword])
      return rows[0]
    },
    async createUser(actorId: string, name: string, email: string, hashedPassword: string, roleId: string): Promise<AccountId | undefined> {
      const { rows } = await db.query<AccountId>(`INSERT INTO users (name, email, password_hash, role_id)
        SELECT $2, $3, $4, target.id
        FROM users actor JOIN roles authority ON authority.id = actor.role_id
        JOIN roles target ON target.id = $5
        WHERE actor.id = $1 AND actor.active AND NOT target.is_super_admin AND NOT target.is_reseller
          AND (
            (authority.is_super_admin AND target.reseller_id IS NULL)
            OR (authority.is_reseller AND target.reseller_id = actor.id)
            OR (authority.reseller_id IS NULL AND target.reseller_id IS NULL
              AND NOT authority.is_super_admin AND NOT authority.is_reseller
              AND authority.permissions @> ARRAY['page.users', 'users.create']
              AND authority.permissions @> target.permissions)
          )
        RETURNING id`, [actorId, name, email, hashedPassword, roleId])
      return rows[0]
    },
    async updateUser(actorId: string, id: string, roleId: string, active: boolean): Promise<AccountId | undefined> {
      const { rows } = await db.query<AccountId>(`WITH modified AS (
        UPDATE users account SET role_id = target.id, active = $4
        FROM users actor JOIN roles authority ON authority.id = actor.role_id
        JOIN roles target ON target.id = $3, roles existing
        WHERE account.id = $2 AND actor.id = $1 AND account.id <> actor.id AND actor.active
          AND existing.id = account.role_id AND NOT existing.is_super_admin AND NOT target.is_super_admin
          AND existing.is_reseller = target.is_reseller
          AND existing.reseller_id IS NOT DISTINCT FROM target.reseller_id
          AND (
            authority.is_super_admin
            OR (authority.is_reseller AND existing.reseller_id = actor.id)
            OR (authority.reseller_id IS NULL AND existing.reseller_id IS NULL
              AND NOT authority.is_reseller AND NOT existing.is_reseller
              AND authority.permissions @> ARRAY['page.users', 'users.update']
              AND authority.permissions @> target.permissions AND authority.permissions @> existing.permissions)
          )
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


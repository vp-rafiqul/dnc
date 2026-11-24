import type { Pool } from "pg"
import type { ApiKey } from "../../../../shared/contracts.ts"
import type { AccountPrincipalRow } from "../auth/auth.service.ts"

type KeyRow = ApiKey<Date>
type KeySecret = Pick<KeyRow, "revoked_at"> & { secret_hash: string; encrypted_secret: Buffer | null }
type KeyOwner = AccountPrincipalRow & { key_id: string }

interface RequestUsage {
  request_limit: number
  remaining: number
  retry_after: number
  allowed: boolean
}

const keyFields = "id, name, prefix, created_at, revoked_at, rate_limit_per_minute, encrypted_secret IS NOT NULL AS can_reveal"

export function keysRepository(db: Pool) {
  return {
    async list(userId: string) {
      return (await db.query<KeyRow>(`SELECT ${keyFields} FROM api_keys
        WHERE user_id = $1 ORDER BY created_at DESC, id DESC`, [userId])).rows
    },
    async create(userId: string, name: string, prefix: string, hash: string, rateLimitPerMinute: number, encryptedSecret: Buffer) {
      return (await db.query<KeyRow>(`INSERT INTO api_keys (user_id, name, prefix, secret_hash, rate_limit_per_minute, encrypted_secret)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${keyFields}`, [userId, name, prefix, hash, rateLimitPerMinute, encryptedSecret])).rows[0]
    },
    async findSecret(userId: string, id: string): Promise<KeySecret | undefined> {
      return (await db.query<KeySecret>(`SELECT revoked_at, secret_hash, encrypted_secret FROM api_keys
        WHERE user_id = $1 AND id = $2`, [userId, id])).rows[0]
    },
    async updateRateLimit(userId: string, id: string, rateLimitPerMinute: number): Promise<KeyRow | undefined> {
      return (await db.query<KeyRow>(`UPDATE api_keys SET rate_limit_per_minute = $3
        WHERE user_id = $1 AND id = $2 AND revoked_at IS NULL
        RETURNING ${keyFields}`, [userId, id, rateLimitPerMinute])).rows[0]
    },
    async consumeRequest(id: string): Promise<RequestUsage | undefined> {
      const { rows } = await db.query<RequestUsage>(`WITH locked_key AS MATERIALIZED (
        SELECT id, rate_limit_per_minute, rate_window_start, rate_request_count
        FROM api_keys WHERE id = $1 AND revoked_at IS NULL FOR UPDATE
      ), checked_at AS MATERIALIZED (
        SELECT locked_key.*, clock_timestamp() AS checked FROM locked_key
      ), usage AS (
        SELECT id, rate_limit_per_minute AS request_limit, checked,
          date_trunc('minute', checked) AS window_start,
          CASE WHEN rate_window_start = date_trunc('minute', checked)
            THEN rate_request_count ELSE 0 END AS used
        FROM checked_at
      ), consumed AS (
        UPDATE api_keys k SET rate_window_start = usage.window_start, rate_request_count = usage.used + 1
        FROM usage WHERE k.id = usage.id AND usage.used < usage.request_limit
        RETURNING k.id
      )
      SELECT usage.request_limit, consumed.id IS NOT NULL AS allowed,
        greatest(0, usage.request_limit - usage.used - CASE WHEN consumed.id IS NULL THEN 0 ELSE 1 END) AS remaining,
        ceil(extract(epoch FROM usage.window_start + interval '1 minute' - usage.checked))::integer AS retry_after
      FROM usage LEFT JOIN consumed ON consumed.id = usage.id`, [id])
      return rows[0]
    },
    async revoke(userId: string, id: string): Promise<{ id: string } | undefined> {
      return (await db.query<{ id: string }>(`UPDATE api_keys SET revoked_at = COALESCE(revoked_at, now()), encrypted_secret = NULL
        WHERE user_id = $1 AND id = $2 RETURNING id`, [userId, id])).rows[0]
    },
    async findOwner(hash: string): Promise<KeyOwner | undefined> {
      return (await db.query<KeyOwner>(`SELECT k.id AS key_id, u.id, u.name, u.email, r.name AS role, r.is_super_admin, r.is_reseller, r.permissions
        FROM api_keys k JOIN users u ON u.id = k.user_id JOIN roles r ON r.id = u.role_id
        WHERE k.secret_hash = $1 AND k.revoked_at IS NULL AND u.active`, [hash])).rows[0]
    },
  }
}

import type { Database } from "../../db/prisma.ts"
import type { Prisma } from "../../generated/prisma/client.ts"
import type { ApiKey } from "../../../../shared/contracts.ts"
import { principalRow } from "../auth/auth.repository.ts"

const minuteMs = 60_000
const keyFields = {
  id: true, name: true, prefix: true, created_at: true, revoked_at: true,
  rate_limit_per_minute: true, encrypted_secret: true,
} satisfies Prisma.ApiKeySelect
const usageFields = { rate_limit_per_minute: true, rate_request_count: true } satisfies Prisma.ApiKeySelect

type KeyRow = Prisma.ApiKeyGetPayload<{ select: typeof keyFields }>
type Usage = Prisma.ApiKeyGetPayload<{ select: typeof usageFields }>

function publicKey({ encrypted_secret, ...row }: KeyRow): ApiKey<Date> {
  return { ...row, can_reveal: encrypted_secret !== null }
}

function usage(row: Usage, windowStart: Date, allowed: boolean) {
  return {
    allowed,
    request_limit: row.rate_limit_per_minute,
    remaining: Math.max(0, row.rate_limit_per_minute - row.rate_request_count),
    retry_after: Math.max(1, Math.ceil((windowStart.getTime() + minuteMs - Date.now()) / 1000)),
  }
}

export function keysRepository(db: Database) {
  return {
    async list(userId: string) {
      const keys = await db.apiKey.findMany({
        where: { user_id: userId }, select: keyFields, orderBy: [{ created_at: "desc" }, { id: "desc" }],
      })
      return keys.map(publicKey)
    },
    async create(userId: string, name: string, prefix: string, hash: string, rateLimitPerMinute: number, encryptedSecret: Buffer) {
      const key = await db.apiKey.create({
        data: {
          user_id: userId, name, prefix, secret_hash: hash,
          rate_limit_per_minute: rateLimitPerMinute, encrypted_secret: new Uint8Array(encryptedSecret),
        },
        select: keyFields,
      })
      return publicKey(key)
    },
    async findSecret(userId: string, id: string) {
      return db.apiKey.findFirst({
        where: { id, user_id: userId },
        select: { revoked_at: true, secret_hash: true, encrypted_secret: true },
      })
    },
    async updateRateLimit(userId: string, id: string, rateLimitPerMinute: number) {
      const [key] = await db.apiKey.updateManyAndReturn({
        where: { id, user_id: userId, revoked_at: null }, data: { rate_limit_per_minute: rateLimitPerMinute }, select: keyFields,
      })
      return key ? publicKey(key) : undefined
    },
    async consumeRequest(id: string) {
      const activeKey = { id, revoked_at: null }
      for (;;) {
        const windowStart = new Date(Math.floor(Date.now() / minuteMs) * minuteMs)
        const [incremented] = await db.apiKey.updateManyAndReturn({
          where: {
            ...activeKey, rate_window_start: windowStart,
            rate_request_count: { lt: db.apiKey.fields.rate_limit_per_minute },
          },
          data: { rate_request_count: { increment: 1 } }, select: usageFields,
        })
        if (incremented) return usage(incremented, windowStart, true)
        const [reset] = await db.apiKey.updateManyAndReturn({
          where: { ...activeKey, OR: [{ rate_window_start: null }, { rate_window_start: { lt: windowStart } }] },
          data: { rate_window_start: windowStart, rate_request_count: 1 }, select: usageFields,
        })
        if (reset) return usage(reset, windowStart, true)
        const current = await db.apiKey.findFirst({
          where: activeKey, select: { ...usageFields, rate_window_start: true },
        })
        if (!current) return undefined
        if (Date.now() >= windowStart.getTime() + minuteMs) continue
        // Another request may have opened this window between the two updates.
        if (current.rate_window_start?.getTime() === windowStart.getTime()
          && current.rate_request_count < current.rate_limit_per_minute) continue
        return usage(current, current.rate_window_start ?? windowStart, false)
      }
    },
    async revoke(userId: string, id: string) {
      // Preserve the original timestamp when revocation is repeated.
      const revoked = await db.apiKey.updateMany({
        where: { id, user_id: userId, revoked_at: null },
        data: { revoked_at: new Date(), encrypted_secret: null },
      })
      if (revoked.count) return true
      return (await db.apiKey.count({ where: { id, user_id: userId } })) > 0
    },
    async findOwner(hash: string) {
      const key = await db.apiKey.findFirst({
        where: { secret_hash: hash, revoked_at: null, user: { active: true } },
        select: { id: true, user: { select: { id: true, name: true, email: true, role: true } } },
      })
      return key ? { ...principalRow(key.user), key_id: key.id } : undefined
    },
  }
}

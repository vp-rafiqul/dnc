import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"
import { z } from "zod"
import { HttpError } from "../../errors.js"
import { toPrincipal } from "../auth/auth.service.js"

const digest = (value) => createHash("sha256").update(value).digest("hex")
const defaultRateLimit = 60
const rateLimit = z.int32().positive()
const createInput = z.object({ name: z.string().trim().min(1).max(80), rateLimitPerMinute: rateLimit.optional() })
const updateInput = z.object({ rateLimitPerMinute: rateLimit })
const keyPattern = /^dnc_[A-Za-z0-9_-]{43}$/

export function keysService(repository, encryptionKey) {
  function encrypt(secret, hash) {
    const iv = randomBytes(12)
    const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv)
    cipher.setAAD(Buffer.from(hash, "hex"))
    const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext])
  }

  return {
    list: repository.list,
    async create(user, body) {
      const { name, rateLimitPerMinute = defaultRateLimit } = createInput.parse(body)
      if (rateLimitPerMinute !== defaultRateLimit && !user.permissions.includes("keys.update_rate_limit")) {
        throw new HttpError(403, "You do not have permission to customize the rate limit.")
      }
      const secret = `dnc_${randomBytes(32).toString("base64url")}`
      const hash = digest(secret)
      const key = await repository.create(user.id, name, secret.slice(0, 12), hash, rateLimitPerMinute, encrypt(secret, hash))
      return { ...key, secret }
    },
    async reveal(userId, id) {
      const key = await repository.findSecret(userId, id)
      if (!key || key.revoked_at) throw new HttpError(404, "Active API key not found.")
      if (!key.encrypted_secret) throw new HttpError(409, "This older key cannot be copied. Create a replacement key to get a copyable value.")
      const stored = key.encrypted_secret
      const decipher = createDecipheriv("aes-256-gcm", encryptionKey, stored.subarray(0, 12))
      decipher.setAAD(Buffer.from(key.secret_hash, "hex"))
      decipher.setAuthTag(stored.subarray(12, 28))
      return { secret: Buffer.concat([decipher.update(stored.subarray(28)), decipher.final()]).toString("utf8") }
    },
    async updateRateLimit(userId, id, body) {
      const { rateLimitPerMinute } = updateInput.parse(body)
      const key = await repository.updateRateLimit(userId, id, rateLimitPerMinute)
      if (!key) throw new HttpError(404, "Active API key not found.")
      return key
    },
    async consumeRequest(keyId) {
      const usage = await repository.consumeRequest(keyId)
      if (!usage) throw new HttpError(401, "A valid API key is required.")
      return usage
    },
    async revoke(userId, id) {
      if (!await repository.revoke(userId, id)) throw new HttpError(404, "API key not found.")
    },
    async authenticate(secret) {
      if (!keyPattern.test(secret || "")) throw new HttpError(401, "A valid API key is required.")
      const owner = await repository.findOwner(digest(secret))
      if (!owner) throw new HttpError(401, "A valid API key is required.")
      return { user: toPrincipal(owner), apiKeyId: owner.key_id }
    },
  }
}

import { createHash, randomBytes } from "node:crypto"
import { z } from "zod"
import { HttpError } from "../../errors.js"
import { toPrincipal } from "../auth/auth.service.js"

const digest = (value) => createHash("sha256").update(value).digest("hex")

export function keysService(repository) {
  return {
    list: repository.list,
    async create(userId, body) {
      const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(body)
      const secret = `dnc_${randomBytes(32).toString("base64url")}`
      const key = await repository.create(userId, name, secret.slice(0, 12), digest(secret))
      return { ...key, secret }
    },
    async revoke(userId, id) {
      if (!await repository.revoke(userId, id)) throw new HttpError(404, "API key not found.")
    },
    async authenticate(secret) {
      if (!/^dnc_[A-Za-z0-9_-]{43}$/.test(secret || "")) throw new HttpError(401, "A valid API key is required.")
      const user = await repository.findOwner(digest(secret))
      if (!user) throw new HttpError(401, "A valid API key is required.")
      return toPrincipal(user)
    },
  }
}

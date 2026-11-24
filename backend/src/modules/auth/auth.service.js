import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"
import { SignJWT, jwtVerify } from "jose"
import { HttpError } from "../../errors.js"
import { permissionIds } from "../../permissions.js"

const derive = promisify(scrypt)
const sessionSeconds = 8 * 60 * 60
const jwtOptions = { issuer: "dnc-screening", audience: "dnc-workspace" }

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex")
  const hash = await derive(password, salt, 64)
  return `${salt}:${hash.toString("hex")}`
}

export function toPrincipal(row) {
  return {
    id: row.id, name: row.name, email: row.email, role: row.role,
    isSuperAdmin: row.is_super_admin,
    permissions: row.is_super_admin ? permissionIds : row.permissions,
  }
}

export function authService(repository, secret) {
  return {
    async login(email, password) {
      const user = await repository.findByEmail(email.toLowerCase())
      const [salt, expected] = user?.password_hash.split(":") || ["unknown-account", "00".repeat(64)]
      const actual = await derive(password, salt, 64)
      if (!timingSafeEqual(actual, Buffer.from(expected, "hex")) || !user?.active) {
        throw new HttpError(401, "Invalid email or password.")
      }

      const sessionId = randomUUID()
      const expiresAt = Math.floor(Date.now() / 1000) + sessionSeconds
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: "HS256" }).setSubject(user.id).setJti(sessionId)
        .setIssuer(jwtOptions.issuer).setAudience(jwtOptions.audience)
        .setIssuedAt().setExpirationTime(expiresAt).sign(secret)
      await repository.createSession(sessionId, user.id, new Date(expiresAt * 1000))
      return { token, maxAge: sessionSeconds * 1000, user: toPrincipal(user) }
    },
    async authenticate(token) {
      let claims
      try {
        const result = await jwtVerify(token, secret, { ...jwtOptions, algorithms: ["HS256"], requiredClaims: ["sub", "jti", "exp"] })
        claims = result.payload
      } catch {
        throw new HttpError(401, "Sign in to continue.")
      }
      const user = await repository.findSession(claims.jti, claims.sub)
      if (!user) throw new HttpError(401, "Sign in to continue.")
      return { user: toPrincipal(user), sessionId: claims.jti }
    },
    logout: repository.deleteSession,
  }
}

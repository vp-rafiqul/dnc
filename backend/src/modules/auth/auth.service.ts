import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto"
import { SignJWT, jwtVerify } from "jose"
import type { JWTPayload } from "jose"
import { z } from "zod"
import { HttpError } from "../../errors.ts"
import { permissionIds, resellerPermissions } from "../../permissions.ts"
import type { Permission, Principal } from "../../../../shared/contracts.ts"
import type { authRepository } from "./auth.repository.ts"

function derive(password: string, salt: string) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, (error, hash) => error ? reject(error) : resolve(hash))
  })
}
const sessionSeconds = 8 * 60 * 60
const jwtOptions = { issuer: "dnc-screening", audience: "dnc-workspace" }

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex")
  const hash = await derive(password, salt)
  return `${salt}:${hash.toString("hex")}`
}

export interface AccountPrincipalRow {
  id: string
  name: string
  email: string
  role: string
  is_super_admin: boolean
  is_reseller: boolean
  permissions: Permission[]
}

export function toPrincipal(row: AccountPrincipalRow): Principal {
  return {
    id: row.id, name: row.name, email: row.email, role: row.role,
    isSuperAdmin: row.is_super_admin,
    isReseller: row.is_reseller,
    permissions: row.is_super_admin ? permissionIds : row.is_reseller ? resellerPermissions : row.permissions,
  }
}

const registration = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(80),
  email: z.email("Enter a valid email address.").max(254).transform(value => value.toLowerCase()),
  password: z.string().min(12, "Use at least 12 characters for the password.").max(128),
})

export function authService(repository: ReturnType<typeof authRepository>, secret: Uint8Array) {
  async function startSession(user: AccountPrincipalRow) {
    const sessionId = randomUUID()
    const expiresAt = Math.floor(Date.now() / 1000) + sessionSeconds
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" }).setSubject(user.id).setJti(sessionId)
      .setIssuer(jwtOptions.issuer).setAudience(jwtOptions.audience)
      .setIssuedAt().setExpirationTime(expiresAt).sign(secret)
    await repository.createSession(sessionId, user.id, new Date(expiresAt * 1000))
    return { token, maxAge: sessionSeconds * 1000, user: toPrincipal(user) }
  }

  return {
    // Public seller sign-up: the account gets the self-service seller role and is signed in right away.
    async register(body: unknown) {
      const { name, email, password } = registration.parse(body)
      const user = await repository.createSelfServiceUser(name, email, await hashPassword(password))
      if (user === "unavailable") throw new HttpError(503, "Seller sign-up is not available yet. Contact support.")
      if (user === "exists") throw new HttpError(409, "An account with this email already exists. Sign in instead.")
      return startSession(user)
    },
    async login(email: string, password: string) {
      const user = await repository.findByEmail(email.toLowerCase())
      const [salt, expected] = user?.password_hash.split(":") || ["unknown-account", "00".repeat(64)]
      const actual = await derive(password, salt)
      if (!timingSafeEqual(actual, Buffer.from(expected, "hex")) || !user?.active) {
        throw new HttpError(401, "Invalid email or password.")
      }
      return startSession(user)
    },
    async authenticate(token: string) {
      let claims: JWTPayload
      try {
        const result = await jwtVerify(token, secret, { ...jwtOptions, algorithms: ["HS256"], requiredClaims: ["sub", "jti", "exp"] })
        claims = result.payload
      } catch {
        throw new HttpError(401, "Sign in to continue.")
      }
      if (!claims.jti || !claims.sub) throw new HttpError(401, "Sign in to continue.")
      const user = await repository.findSession(claims.jti, claims.sub)
      if (!user) throw new HttpError(401, "Sign in to continue.")
      return { user: toPrincipal(user), sessionId: claims.jti }
    },
    logout: repository.deleteSession,
  }
}

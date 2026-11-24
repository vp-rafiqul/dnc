import type { Database } from "../../db/prisma.ts"
import type { Role, User } from "../../generated/prisma/client.ts"
import { isPermission } from "../../permissions.ts"
import type { AccountPrincipalRow } from "./auth.service.ts"

type PrincipalAccount = Pick<User, "id" | "name" | "email"> & {
  role: Pick<Role, "name" | "is_super_admin" | "is_reseller" | "permissions">
}

export function principalRow(account: PrincipalAccount): AccountPrincipalRow {
  return {
    id: account.id, name: account.name, email: account.email, role: account.role.name,
    is_super_admin: account.role.is_super_admin, is_reseller: account.role.is_reseller,
    permissions: account.role.permissions.filter(isPermission),
  }
}

export function authRepository(db: Database) {
  return {
    async findByEmail(email: string) {
      const account = await db.user.findUnique({ where: { email }, include: { role: true } })
      if (!account) return undefined
      return { ...principalRow(account), active: account.active, password_hash: account.password_hash }
    },
    async createSession(id: string, userId: string, expiresAt: Date) {
      await db.$transaction([
        db.session.deleteMany({ where: { expires_at: { lte: new Date() } } }),
        db.session.create({ data: { id, user_id: userId, expires_at: expiresAt } }),
      ])
    },
    async findSession(id: string, userId: string) {
      const session = await db.session.findFirst({
        where: { id, user_id: userId, expires_at: { gt: new Date() }, user: { active: true } },
        select: { user: { select: { id: true, name: true, email: true, role: true } } },
      })
      return session ? principalRow(session.user) : undefined
    },
    async deleteSession(id: string) {
      await db.session.deleteMany({ where: { id } })
    },
  }
}

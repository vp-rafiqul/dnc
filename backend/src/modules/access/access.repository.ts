import { serializable } from "../../db/prisma.ts"
import type { Database, Transaction } from "../../db/prisma.ts"
import type { Prisma, Role } from "../../generated/prisma/client.ts"
import { isPermission } from "../../permissions.ts"
import type { Permission, Principal } from "../../../../shared/contracts.ts"

function visibleScope(actor: Principal): Prisma.RoleWhereInput {
  if (actor.isSuperAdmin) return {}
  if (actor.isReseller) return { reseller_id: actor.id }
  return { reseller_id: null, is_reseller: false }
}

function authority(tx: Transaction, actorId: string) {
  return tx.user.findFirst({
    where: { id: actorId, active: true }, select: { id: true, role: true },
  })
}
type Authority = NonNullable<Awaited<ReturnType<typeof authority>>>

function canManageUsers(actor: Authority, target: Role, permission: "users.create" | "users.update") {
  if (target.is_super_admin) return false
  if (actor.role.is_super_admin) return true
  if (actor.role.is_reseller) return target.reseller_id === actor.id
  return !target.is_reseller && !target.reseller_id && !actor.role.reseller_id
    && actor.role.permissions.includes("page.users") && actor.role.permissions.includes(permission)
    && target.permissions.every(id => actor.role.permissions.includes(id))
}

export function accessRepository(db: Database) {
  return {
    async listRoles(actor: Principal) {
      const roles = await db.role.findMany({
        where: visibleScope(actor), include: { reseller: { select: { name: true } } },
        orderBy: [{ is_super_admin: "desc" }, { is_reseller: "desc" }, { name: "asc" }, { id: "asc" }],
      })
      return roles.map(({ reseller, permissions, ...role }) => ({
        ...role, reseller: reseller?.name ?? null, permissions: permissions.filter(isPermission),
      }))
    },
    async saveRole(actorId: string, id: string | null, name: string, permissions: Permission[], assignable: Permission[]) {
      return serializable(db, async tx => {
        const actor = await authority(tx, actorId)
        if (!actor || (!actor.role.is_super_admin && !actor.role.is_reseller)) return undefined
        const allowed = permissions.every(permission => assignable.includes(permission))
        if (!id) {
          if (actor.role.is_reseller && !allowed) return undefined
          return tx.role.create({ data: { name, permissions, reseller_id: actor.role.is_reseller ? actor.id : null } })
        }
        const target = await tx.role.findUnique({ where: { id } })
        if (!target || target.is_super_admin || target.is_reseller) return undefined
        if (!actor.role.is_super_admin && target.reseller_id !== actor.id) return undefined
        if (target.reseller_id && !allowed) return undefined
        return tx.role.update({
          where: { id }, data: { name, permissions },
          select: { id: true, name: true, permissions: true, reseller_id: true },
        })
      })
    },
    async listUsers(actor: Principal) {
      const users = await db.user.findMany({
        where: { role: visibleScope(actor) },
        select: {
          id: true, name: true, email: true, active: true, role_id: true,
          role: { include: { reseller: { select: { name: true } } } },
        },
        orderBy: [{ created_at: "desc" }, { id: "asc" }],
      })
      return users.map(({ role, ...user }) => ({
        ...user, role: role.name, reseller: role.reseller?.name ?? null, reseller_id: role.reseller_id,
        is_super_admin: role.is_super_admin, is_reseller: role.is_reseller,
        permissions: role.permissions.filter(isPermission),
      }))
    },
    async createReseller(actorId: string, name: string, email: string, hashedPassword: string) {
      return serializable(db, async tx => {
        const actor = await authority(tx, actorId)
        if (!actor?.role.is_super_admin) return undefined
        const target = await tx.role.findFirst({ where: { is_reseller: true }, select: { id: true } })
        if (!target) return undefined
        return tx.user.create({
          data: { name, email, password_hash: hashedPassword, role_id: target.id }, select: { id: true },
        })
      })
    },
    async createUser(actorId: string, name: string, email: string, hashedPassword: string, roleId: string) {
      return serializable(db, async tx => {
        const actor = await authority(tx, actorId)
        const target = await tx.role.findUnique({ where: { id: roleId } })
        if (!actor || !target || target.is_reseller || !canManageUsers(actor, target, "users.create")) return undefined
        if (actor.role.is_super_admin && target.reseller_id) return undefined
        return tx.user.create({
          data: { name, email, password_hash: hashedPassword, role_id: target.id }, select: { id: true },
        })
      })
    },
    async updateUser(actorId: string, id: string, roleId: string, active: boolean) {
      if (id === actorId) return undefined
      return serializable(db, async tx => {
        const actor = await authority(tx, actorId)
        const account = await tx.user.findUnique({ where: { id }, select: { role: true } })
        const target = await tx.role.findUnique({ where: { id: roleId } })
        if (!actor || !account || !target) return undefined
        const existing = account.role
        if (existing.is_reseller !== target.is_reseller || existing.reseller_id !== target.reseller_id) return undefined
        if (!canManageUsers(actor, existing, "users.update") || !canManageUsers(actor, target, "users.update")) return undefined

        const updated = await tx.user.update({ where: { id }, data: { role_id: target.id, active }, select: { id: true } })
        if (!active) {
          await tx.session.deleteMany({ where: { user_id: id } })
          await tx.apiKey.updateMany({
            where: { user_id: id, revoked_at: null }, data: { revoked_at: new Date(), encrypted_secret: null },
          })
        }
        return updated
      })
    },
  }
}

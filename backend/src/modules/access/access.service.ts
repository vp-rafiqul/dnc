import { z } from "zod"
import { HttpError } from "../../errors.ts"
import { permissionIds, permissions, resellerAssignablePermissions, resellerPermissions } from "../../permissions.ts"
import { hashPassword } from "../auth/auth.service.ts"
import type { PermissionCatalog, Principal, Role, RoleCatalog, WorkspaceUser } from "../../../../shared/contracts.ts"
import type { accessRepository } from "./access.repository.ts"

const text = (max: number) => z.string().trim().min(1).max(max)
const roleInput = z.object({ name: text(60), permissions: z.array(z.enum(permissionIds)).max(permissionIds.length) })
const accountInput = z.object({
  name: text(80), email: z.email().max(254), password: z.string().min(12).max(128),
})
const userInput = accountInput.extend({ roleId: z.uuid() })
const userUpdate = z.object({ roleId: z.uuid(), active: z.boolean() })
const assignable = new Set<string>(resellerAssignablePermissions)
const resellerCatalog: PermissionCatalog = {
  pages: Object.fromEntries(Object.entries(permissions.pages).filter(([id]) => assignable.has(id))),
  actions: Object.fromEntries(Object.entries(permissions.actions).filter(([id]) => assignable.has(id))),
}

export function accessService(repository: ReturnType<typeof accessRepository>) {
  function canManage(actor: Principal, role: Pick<Role, "is_super_admin" | "is_reseller" | "reseller_id" | "permissions">) {
    if (role.is_super_admin) return false
    if (actor.isSuperAdmin) return true
    if (actor.isReseller) return role.reseller_id === actor.id
    return !role.is_reseller && !role.reseller_id && role.permissions.every(permission => actor.permissions.includes(permission))
  }

  return {
    async roleCatalog(actor: Principal): Promise<RoleCatalog> {
      const roles = await repository.listRoles(actor)
      return {
        catalog: actor.isReseller ? resellerCatalog : permissions,
        resellerCatalog,
        roles: roles.map(role => role.is_reseller ? { ...role, permissions: resellerPermissions } : role),
      }
    },
    async assignableRoles(actor: Principal) {
      return (await repository.listRoles(actor)).filter(role => !role.is_reseller && canManage(actor, role))
        .map(({ id, name, reseller_id }) => ({ id, name, reseller_id }))
    },
    async saveRole(actor: Principal, id: string | null, body: unknown) {
      if (!actor.isSuperAdmin && !actor.isReseller) throw new HttpError(403, "You cannot manage roles.")
      const { name, permissions } = roleInput.parse(body)
      if (actor.isReseller && permissions.some(permission => !resellerAssignablePermissions.includes(permission))) {
        throw new HttpError(403, "This permission cannot be assigned to a reseller user.")
      }
      const saved = await repository.saveRole(actor.id, id, name, [...new Set(permissions)], resellerAssignablePermissions)
      if (!saved) throw new HttpError(id ? 404 : 403, id ? "Editable role not found or permissions unavailable." : "You cannot create this role.")
      return saved
    },
    async listUsers(actor: Principal): Promise<WorkspaceUser[]> {
      return (await repository.listUsers(actor)).map(({ permissions, ...user }) => ({
        ...user, manageable: actor.id !== user.id && canManage(actor, { ...user, permissions }),
      }))
    },
    async createReseller(actor: Principal, body: unknown) {
      const { name, email, password } = accountInput.parse(body)
      const account = await repository.createReseller(actor.id, name, email.toLowerCase(), await hashPassword(password))
      if (!account) throw new HttpError(403, "You cannot create a reseller.")
      return account
    },
    async createUser(actor: Principal, body: unknown) {
      const { name, email, password, roleId } = userInput.parse(body)
      const account = await repository.createUser(actor.id, name, email.toLowerCase(), await hashPassword(password), roleId)
      if (!account) throw new HttpError(403, "You cannot assign this role.")
      return account
    },
    async updateUser(actor: Principal, id: string, body: unknown) {
      const { roleId, active } = userUpdate.parse(body)
      const account = await repository.updateUser(actor.id, id, roleId, active)
      if (!account) throw new HttpError(403, "You cannot manage this account or assign this role.")
      return account
    },
  }
}

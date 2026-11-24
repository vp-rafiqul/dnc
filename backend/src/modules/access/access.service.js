import { z } from "zod"
import { HttpError } from "../../errors.js"
import { permissionIds, permissions } from "../../permissions.js"
import { hashPassword } from "../auth/auth.service.js"

const text = (max) => z.string().trim().min(1).max(max)
const roleInput = z.object({ name: text(60), permissions: z.array(z.enum(permissionIds)).max(permissionIds.length) })
const userInput = z.object({
  name: text(80), email: z.email().max(254), password: z.string().min(12).max(128), roleId: z.uuid(),
})
const userUpdate = z.object({ roleId: z.uuid(), active: z.boolean() })

export function accessService(repository) {
  const canManage = (actor, role) => !role.is_super_admin &&
    (actor.isSuperAdmin || role.permissions.every(permission => actor.permissions.includes(permission)))

  return {
    async roleCatalog() {
      return { catalog: permissions, roles: await repository.listRoles() }
    },
    async assignableRoles(actor) {
      return (await repository.listRoles()).filter(role => canManage(actor, role))
        .map(({ id, name }) => ({ id, name }))
    },
    async saveRole(id, body) {
      const { name, permissions } = roleInput.parse(body)
      const saved = await repository.saveRole(id, name, [...new Set(permissions)])
      if (!saved) throw new HttpError(404, "Editable role not found.")
      return saved
    },
    async listUsers(actor) {
      return (await repository.listUsers()).map(({ permissions, ...user }) => ({
        ...user, manageable: actor.id !== user.id && canManage(actor, { ...user, permissions }),
      }))
    },
    async createUser(actor, body) {
      const { name, email, password, roleId } = userInput.parse(body)
      const account = await repository.createUser(actor.id, name, email.toLowerCase(), await hashPassword(password), roleId)
      if (!account) throw new HttpError(403, "You cannot assign this role.")
      return account
    },
    async updateUser(actor, id, body) {
      const { roleId, active } = userUpdate.parse(body)
      const account = await repository.updateUser(actor.id, id, roleId, active)
      if (!account) throw new HttpError(403, "You cannot manage this account or assign this role.")
      return account
    },
  }
}

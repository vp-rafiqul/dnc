import { Router } from "express"
import type { RequestHandler } from "express"
import { z } from "zod"
import { allow, superAdmin } from "../auth/auth.middleware.ts"
import type { accessService } from "./access.service.ts"

export function accessController(service: ReturnType<typeof accessService>, authenticate: RequestHandler[]) {
  const router = Router()
  router.use(...authenticate)
  router.get("/roles", allow("page.roles", "roles.list"), async (req, res) => res.json(await service.roleCatalog(req.user)))
  router.post("/roles", allow("page.roles"), async (req, res) => res.status(201).json(await service.saveRole(req.user, null, req.body)))
  router.put("/roles/:id", allow("page.roles"), async (req, res) => res.json(await service.saveRole(req.user, z.uuid().parse(req.params.id), req.body)))
  router.post("/resellers", superAdmin, async (req, res) => res.status(201).json(await service.createReseller(req.user, req.body)))
  router.get("/users/assignable-roles", allow("page.users"), async (req, res) => {
    if (!req.user.permissions.some(permission => ["users.create", "users.update"].includes(permission))) {
      return res.status(403).json({ error: "You cannot assign roles." })
    }
    res.json(await service.assignableRoles(req.user))
  })
  router.get("/users", allow("page.users", "users.list"), async (req, res) => res.json(await service.listUsers(req.user)))
  router.post("/users", allow("page.users", "users.create"), async (req, res) => res.status(201).json(await service.createUser(req.user, req.body)))
  router.patch("/users/:id", allow("page.users", "users.update"), async (req, res) => res.json(await service.updateUser(req.user, z.uuid().parse(req.params.id), req.body)))
  return router
}

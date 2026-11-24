import { Router } from "express"
import { z } from "zod"
import { allow } from "../auth/auth.middleware.js"

export function keysController(service, authenticate) {
  const router = Router()
  router.use(authenticate, allow("page.keys"))
  router.get("/", allow("keys.list"), async (req, res) => res.json(await service.list(req.user.id)))
  router.post("/", allow("keys.create", "screening.api"), async (req, res) => res.status(201).json(await service.create(req.user, req.body)))
  router.get("/:id/secret", allow("keys.reveal"), async (req, res) => {
    res.json(await service.reveal(req.user.id, z.uuid().parse(req.params.id)))
  })
  router.patch("/:id", allow("keys.update_rate_limit"), async (req, res) => {
    res.json(await service.updateRateLimit(req.user.id, z.uuid().parse(req.params.id), req.body))
  })
  router.delete("/:id", allow("keys.revoke"), async (req, res) => {
    await service.revoke(req.user.id, z.uuid().parse(req.params.id))
    res.sendStatus(204)
  })
  return router
}

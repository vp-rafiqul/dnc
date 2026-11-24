import { Router } from "express"
import { allow } from "../auth/auth.middleware.js"

export function screeningController(service, authenticate, apiAuthenticate) {
  const router = Router()
  router.post("/screening/check", authenticate, allow("page.screening", "screening.check"),
    async (req, res) => res.json(await service.check(req.user.id, req.body, "web")))
  router.get("/screening/history", authenticate, allow("page.history", "history.read"),
    async (req, res) => res.json(await service.recent(req.user.id)))
  router.post("/v1/screening/check", apiAuthenticate, allow("screening.api"),
    async (req, res) => res.json(await service.check(req.user.id, req.body, "api")))
  return router
}

import { Router } from "express"
import type { RequestHandler } from "express"
import { z } from "zod"
import { allow } from "../auth/auth.middleware.ts"
import type { sellersService } from "./sellers.service.ts"

const reviewStatus = z.enum(["AWAITING_PAYMENT", "PENDING", "VERIFIED", "REJECTED", "REVIEW_REQUIRED", "EXPIRED", "REVIEW_DUE"]).optional()

export function sellerController(service: ReturnType<typeof sellersService>, authenticate: RequestHandler[]) {
  const router = Router()
  router.use(...authenticate, allow("page.seller", "seller.manage"))
  router.get("/", async (req, res) => res.json(await service.overview(req.user)))
  router.post("/", async (req, res) => res.status(201).json(await service.create(req.user, req.body)))
  router.put("/", async (req, res) => res.json(await service.update(req.user, req.body)))
  router.post("/authorizations", async (req, res) => {
    res.status(201).json(await service.sign(req.user, req.body, { ip: req.ip, userAgent: req.get("user-agent") }))
  })
  router.post("/authorizations/:id/revoke", async (req, res) => {
    res.json(await service.revoke(req.user, z.uuid().parse(req.params.id), req.body))
  })
  return router
}

export function sellerReviewController(service: ReturnType<typeof sellersService>, authenticate: RequestHandler[]) {
  const router = Router()
  router.use(...authenticate, allow("page.seller_review", "sellers.review"))
  router.get("/", async (req, res) => res.json(await service.reviewQueue(reviewStatus.parse(req.query.status || undefined))))
  router.get("/:id", async (req, res) => res.json(await service.reviewDetail(z.uuid().parse(req.params.id))))
  router.post("/:id/san", async (req, res) => res.json(await service.revealSan(req.user, z.uuid().parse(req.params.id))))
  router.post("/subscriptions/:id/verifications", async (req, res) => {
    res.status(201).json(await service.verify(req.user, z.uuid().parse(req.params.id), req.body))
  })
  return router
}

import express, { Router } from "express"
import type { RequestHandler } from "express"
import { z } from "zod"
import { allow } from "../auth/auth.middleware.ts"
import type { billingService } from "./billing.service.ts"

type Service = ReturnType<typeof billingService>

export function sellerBillingController(service: Service, authenticate: RequestHandler[]) {
  const router = Router()
  router.use(...authenticate, allow("page.seller", "seller.manage"))
  router.get("/catalog", async (_req, res) => res.json(await service.sellerCatalog()))
  router.post("/subscriptions", async (req, res) => res.status(201).json(await service.purchase(req.user, req.body)))
  router.post("/subscriptions/:id/payments", async (req, res) => {
    res.status(201).json(await service.retryPayment(req.user, z.uuid().parse(req.params.id), req.body))
  })
  router.post("/subscriptions/:id/cancel", async (req, res) => {
    await service.cancel(req.user, z.uuid().parse(req.params.id))
    res.sendStatus(204)
  })
  router.post("/payments/:id/refresh", async (req, res) => res.json(await service.refreshPayment(req.user, z.uuid().parse(req.params.id))))
  return router
}

export function adminBillingController(service: Service, authenticate: RequestHandler[]) {
  const router = Router()
  router.use(...authenticate, allow("page.billing", "billing.manage"))
  router.get("/catalog", async (_req, res) => res.json(await service.adminCatalog()))
  router.put("/settings", async (req, res) => res.json(await service.updateSettings(req.user, req.body)))
  router.post("/states", async (req, res) => res.status(201).json(await service.createState(req.body)))
  router.patch("/states/:code", async (req, res) => res.json(await service.updateState(String(req.params.code), req.body)))
  router.post("/area-codes", async (req, res) => res.status(201).json(await service.createAreaCode(req.body)))
  router.patch("/area-codes/:code", async (req, res) => res.json(await service.updateAreaCode(String(req.params.code), req.body)))
  router.get("/payments", async (req, res) => res.json(await service.payments(req.query.status)))
  router.post("/payments/:id/confirm", async (req, res) => res.json(await service.confirmBankTransfer(req.user, z.uuid().parse(req.params.id), req.body)))
  router.post("/payments/:id/reject", async (req, res) => res.json(await service.rejectPayment(req.user, z.uuid().parse(req.params.id), req.body)))
  return router
}

// Stripe needs the exact raw body to verify the signature, so this route parses its own body.
export function stripeWebhookController(service: Service) {
  const router = Router()
  router.post("/stripe/webhook", express.raw({ type: "application/json", limit: "1mb" }), async (req, res) => {
    await service.webhook(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), req.get("stripe-signature"))
    res.json({ received: true })
  })
  return router
}

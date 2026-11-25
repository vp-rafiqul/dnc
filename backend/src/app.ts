import express from "express"
import { rateLimit } from "express-rate-limit"
import type { Options as RateLimitOptions } from "express-rate-limit"
import helmet from "helmet"
import type { Database } from "./db/prisma.ts"
import type { Config } from "./config.ts"
import { errorMiddleware } from "./errors.ts"
import { browserCors } from "./middleware/cors.ts"
import { authRepository } from "./modules/auth/auth.repository.ts"
import { authService } from "./modules/auth/auth.service.ts"
import { sessionAuth } from "./modules/auth/auth.middleware.ts"
import { authController } from "./modules/auth/auth.controller.ts"
import { accessRepository } from "./modules/access/access.repository.ts"
import { accessService } from "./modules/access/access.service.ts"
import { accessController } from "./modules/access/access.controller.ts"
import { keysRepository } from "./modules/keys/keys.repository.ts"
import { keysService } from "./modules/keys/keys.service.ts"
import { keyAuth, keyRateLimit } from "./modules/keys/keys.middleware.ts"
import { keysController } from "./modules/keys/keys.controller.ts"
import { screeningRepository } from "./modules/screening/screening.repository.ts"
import { screeningService } from "./modules/screening/screening.service.ts"
import { screeningApiController, screeningController } from "./modules/screening/screening.controller.ts"
import { historyRepository } from "./modules/screening/history.repository.ts"
import { historySearch } from "./modules/screening/history-search.ts"
import { historyService } from "./modules/screening/history.service.ts"
import { sanVault } from "./modules/sellers/san-vault.ts"
import { sellersRepository } from "./modules/sellers/sellers.repository.ts"
import { sellersService } from "./modules/sellers/sellers.service.ts"
import { sellerController, sellerReviewController } from "./modules/sellers/sellers.controller.ts"
import { billingRepository } from "./modules/billing/billing.repository.ts"
import { billingService } from "./modules/billing/billing.service.ts"
import { adminBillingController, sellerBillingController, stripeWebhookController } from "./modules/billing/billing.controller.ts"
import { stripeClient } from "./modules/billing/stripe.ts"

export function createApp(db: Database, settings: Config, sellerRepository = sellersRepository(db)) {
  const app = express()
  const sellers = sellersService(sellerRepository, sanVault(settings.sanKeys))
  const stripe = settings.stripe ? stripeClient(settings.stripe) : null
  const billing = billingService(billingRepository(db), stripe, settings.frontendOrigin, Boolean(settings.stripe?.webhookSecret),
    settings.stripe?.publishableKey ?? null)
  const auth = authService(authRepository(db), settings.jwtSecret)
  const keys = keysService(keysRepository(db), settings.apiKeyEncryptionKey)
  const search = historySearch(settings.historySearchKey)
  const screening = screeningService(screeningRepository(db), search)
  const history = historyService(historyRepository(db), search)
  const access = accessService(accessRepository(db))
  const parseJson = express.json({ limit: "16kb" })

  const limiter = (limit: number, message: string, options: Partial<RateLimitOptions> = {}) => rateLimit({
    windowMs: 60_000, limit, standardHeaders: "draft-8", legacyHeaders: false, message: { error: message }, ...options,
  })
  const invalidKeyLimiter = limiter(240, "Too many invalid API key requests. Try again in a minute.")
  const invalidSessionLimiter = limiter(240, "Too many invalid session requests. Try again in a minute.")
  const authenticate = sessionAuth(auth, invalidSessionLimiter)
  const restoreSession = sessionAuth(auth, invalidSessionLimiter, "cookie")
  const workspaceAuth = [authenticate, limiter(240, "Too many requests from this account. Try again in a minute.", {
    keyGenerator: req => req.user.id,
  })]

  app.disable("x-powered-by")
  app.use(helmet({ strictTransportSecurity: settings.secureCookie ? undefined : false }))
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store")
    next()
  })
  // Server-to-server webhook: verified by its Stripe signature, not by browser origin or session.
  app.use("/api/billing", stripeWebhookController(billing))
  app.use("/api", browserCors(settings.frontendOrigin))
  app.use("/api", screeningApiController(screening, {
    authenticate: keyAuth(keys, invalidKeyLimiter),
    rateLimit: keyRateLimit(keys),
    parseJson,
  }))
  app.use(parseJson)
  app.get("/api/health", async (req, res) => {
    await db.registryGeneration.findFirst({ select: { id: true } })
    res.json({ ok: true })
  })
  app.use("/api/auth", authController(auth, authenticate, restoreSession, limiter(12, "Too many sign-in attempts. Try again in a minute."),
    limiter(5, "Too many sign-up attempts. Try again in a minute."), settings.secureCookie))
  app.use("/api/keys", keysController(keys, workspaceAuth))
  app.use("/api", screeningController(screening, history, workspaceAuth))
  app.use("/api/seller/billing", sellerBillingController(billing, workspaceAuth))
  app.use("/api/seller", sellerController(sellers, workspaceAuth))
  app.use("/api/admin/sellers", sellerReviewController(sellers, workspaceAuth))
  app.use("/api/admin/billing", adminBillingController(billing, workspaceAuth))
  app.use("/api/admin", accessController(access, workspaceAuth))
  app.use((req, res) => res.status(404).json({ error: "Endpoint not found." }))
  app.use(errorMiddleware)
  return app
}

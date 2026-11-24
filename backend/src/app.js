import express from "express"
import { rateLimit } from "express-rate-limit"
import helmet from "helmet"
import { errorMiddleware } from "./errors.js"
import { browserCors } from "./middleware/cors.js"
import { authRepository } from "./modules/auth/auth.repository.js"
import { authService } from "./modules/auth/auth.service.js"
import { sessionAuth } from "./modules/auth/auth.middleware.js"
import { authController } from "./modules/auth/auth.controller.js"
import { accessRepository } from "./modules/access/access.repository.js"
import { accessService } from "./modules/access/access.service.js"
import { accessController } from "./modules/access/access.controller.js"
import { keysRepository } from "./modules/keys/keys.repository.js"
import { keysService } from "./modules/keys/keys.service.js"
import { keyAuth, keyRateLimit } from "./modules/keys/keys.middleware.js"
import { keysController } from "./modules/keys/keys.controller.js"
import { screeningRepository } from "./modules/screening/screening.repository.js"
import { screeningService } from "./modules/screening/screening.service.js"
import { screeningApiController, screeningController } from "./modules/screening/screening.controller.js"
import { historyRepository } from "./modules/screening/history.repository.js"
import { historySearch } from "./modules/screening/history-search.js"
import { historyService } from "./modules/screening/history.service.js"

export function createApp(db, settings) {
  const app = express()
  const auth = authService(authRepository(db), settings.jwtSecret)
  const keys = keysService(keysRepository(db), settings.apiKeyEncryptionKey)
  const search = historySearch(settings.historySearchKey)
  const screening = screeningService(screeningRepository(db), search)
  const history = historyService(historyRepository(db), search)
  const access = accessService(accessRepository(db))
  const authenticate = sessionAuth(auth)
  const parseJson = express.json({ limit: "16kb" })

  const limiter = (limit, message) => rateLimit({
    windowMs: 60_000, limit, standardHeaders: "draft-8", legacyHeaders: false, message: { error: message },
  })
  const invalidKeyLimiter = limiter(240, "Too many invalid API key requests. Try again in a minute.")

  app.disable("x-powered-by")
  app.use(helmet({ strictTransportSecurity: settings.secureCookie ? undefined : false }))
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store")
    next()
  })
  app.use("/api", browserCors(settings.frontendOrigin))
  app.use("/api", screeningApiController(screening, {
    authenticate: keyAuth(keys, invalidKeyLimiter),
    rateLimit: keyRateLimit(keys),
    parseJson,
  }))
  app.use("/api", limiter(240, "Too many requests. Try again in a minute."))
  app.use(parseJson)
  app.get("/api/health", async (req, res) => {
    await db.query("SELECT 1")
    res.json({ ok: true })
  })
  app.use("/api/auth", authController(auth, authenticate, limiter(12, "Too many sign-in attempts. Try again in a minute."), settings.secureCookie))
  app.use("/api/keys", keysController(keys, authenticate))
  app.use("/api", screeningController(screening, history, authenticate))
  app.use("/api/admin", accessController(access, authenticate))
  app.use((req, res) => res.status(404).json({ error: "Endpoint not found." }))
  app.use(errorMiddleware)
  return app
}

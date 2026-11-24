import type { RequestHandler } from "express"
import { HttpError } from "../../errors.ts"
import type { keysService } from "./keys.service.ts"

export function keyAuth(service: ReturnType<typeof keysService>, invalidKeyLimiter: RequestHandler): RequestHandler {
  return async (req, res, next) => {
    try {
      Object.assign(req, await service.authenticate(req.get("x-api-key")))
    } catch (error) {
      if (error instanceof HttpError && error.status === 401) {
        return invalidKeyLimiter(req, res, () => next(error))
      }
      throw error
    }
    next()
  }
}

export function keyRateLimit(service: ReturnType<typeof keysService>): RequestHandler {
  return async (req, res, next) => {
    const usage = await service.consumeRequest(req.apiKeyId)
    res.set({
      "X-RateLimit-Limit": String(usage.request_limit),
      "X-RateLimit-Remaining": String(usage.remaining),
    })
    if (!usage.allowed) {
      res.set("Retry-After", String(usage.retry_after))
      throw new HttpError(429, "This API key reached its per-minute request limit.")
    }
    next()
  }
}

import { Router } from "express"
import type { RequestHandler } from "express"
import { z } from "zod"
import { allow } from "../auth/auth.middleware.ts"
import { reportTypes, writeHistoryReport } from "./history.report.ts"
import type { historyService } from "./history.service.ts"
import type { screeningService } from "./screening.service.ts"

const reportFormat = z.enum(["csv", "xlsx", "pdf"])

export function screeningController(service: ReturnType<typeof screeningService>, history: ReturnType<typeof historyService>, authenticate: RequestHandler[]) {
  const router = Router()
  const canReadHistory = allow("page.history", "history.read")
  router.post("/screening/check", ...authenticate, allow("page.screening", "screening.check"),
    async (req, res) => res.json(await service.check(req.user.id, req.body, "web")))
  router.get("/screening/history", ...authenticate, canReadHistory,
    async (req, res) => res.json(await history.recent(req.user.id)))
  router.post("/screening/history", ...authenticate, canReadHistory,
    async (req, res) => res.json(await history.page(req.user.id, req.body)))
  router.post("/screening/history/export/:format", ...authenticate, canReadHistory, async (req, res) => {
    const format = reportFormat.parse(req.params.format)
    const abort = new AbortController()
    const onClose = () => { if (!res.writableFinished) abort.abort() }
    res.once("close", onClose)
    try {
      await history.report(req.user.id, req.body, abort.signal, rows => {
        res.attachment(`screening-history.${format}`).type(reportTypes[format])
        return writeHistoryReport(format, rows, res, abort.signal)
      })
    } catch (error) {
      if (!abort.signal.aborted) throw error
    } finally {
      res.off("close", onClose)
    }
  })
  return router
}

export function screeningApiController(service: ReturnType<typeof screeningService>, { authenticate, rateLimit, parseJson }: {
  authenticate: RequestHandler
  rateLimit: RequestHandler
  parseJson: RequestHandler
}) {
  const router = Router()
  router.post("/v1/screening/check", authenticate, allow("screening.api"), rateLimit, parseJson,
    async (req, res) => res.json(await service.check(req.user.id, req.body, "api")))
  return router
}

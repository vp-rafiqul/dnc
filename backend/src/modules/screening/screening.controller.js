import { Router } from "express"
import { z } from "zod"
import { allow } from "../auth/auth.middleware.js"
import { reportTypes, writeHistoryReport } from "./history.report.js"

const reportFormat = z.enum(Object.keys(reportTypes))

export function screeningController(service, history, authenticate) {
  const router = Router()
  const canReadHistory = allow("page.history", "history.read")
  router.post("/screening/check", authenticate, allow("page.screening", "screening.check"),
    async (req, res) => res.json(await service.check(req.user.id, req.body, "web")))
  router.get("/screening/history", authenticate, canReadHistory,
    async (req, res) => res.json(await history.recent(req.user.id)))
  router.post("/screening/history", authenticate, canReadHistory,
    async (req, res) => res.json(await history.page(req.user.id, req.body)))
  router.post("/screening/history/export/:format", authenticate, canReadHistory, async (req, res) => {
    const format = reportFormat.parse(req.params.format)
    const abort = new AbortController()
    const rows = history.report(req.user.id, req.body, abort.signal)
    const onClose = () => { if (!res.writableFinished) abort.abort() }
    res.once("close", onClose)
    try {
      res.attachment(`screening-history.${format}`).type(reportTypes[format])
      await writeHistoryReport(format, rows, res, abort.signal)
    } catch (error) {
      if (!abort.signal.aborted) throw error
    } finally {
      res.off("close", onClose)
    }
  })
  return router
}

export function screeningApiController(service, { authenticate, rateLimit, parseJson }) {
  const router = Router()
  router.post("/v1/screening/check", authenticate, allow("screening.api"), rateLimit, parseJson,
    async (req, res) => res.json(await service.check(req.user.id, req.body, "api")))
  return router
}

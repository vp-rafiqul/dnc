import { Router } from "express"
import type { CookieOptions, RequestHandler } from "express"
import { z } from "zod"
import { sessionCookie } from "./auth.middleware.ts"
import type { authService } from "./auth.service.ts"

const credentials = z.object({ email: z.email().max(254), password: z.string().min(1).max(128) })

export function authController(service: ReturnType<typeof authService>, authenticate: RequestHandler, restoreSession: RequestHandler, loginLimiter: RequestHandler, secure: boolean) {
  const router = Router()
  const cookieOptions: CookieOptions = { httpOnly: true, sameSite: "strict", secure, path: "/api" }

  router.post("/login", loginLimiter, async (req, res) => {
    const { email, password } = credentials.parse(req.body)
    const { token, maxAge, user } = await service.login(email, password)
    if (req.get("x-dnc-workspace") === "1") res.cookie(sessionCookie, token, { ...cookieOptions, maxAge })
    res.json({ user, accessToken: token, tokenType: "Bearer" })
  })
  router.post("/session", restoreSession, (req, res) => {
    res.json({ user: req.user, accessToken: req.sessionToken, tokenType: "Bearer" })
  })
  router.get("/me", authenticate, (req, res) => res.json({ user: req.user }))
  router.post("/logout", authenticate, async (req, res) => {
    await service.logout(req.sessionId)
    res.clearCookie(sessionCookie, cookieOptions).sendStatus(204)
  })
  return router
}

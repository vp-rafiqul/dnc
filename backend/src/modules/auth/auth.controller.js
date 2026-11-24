import { Router } from "express"
import { z } from "zod"
import { sessionCookie } from "./auth.middleware.js"

const credentials = z.object({ email: z.email().max(254), password: z.string().min(1).max(128) })

export function authController(service, authenticate, loginLimiter, secure) {
  const router = Router()
  const cookieOptions = { httpOnly: true, sameSite: "strict", secure, path: "/api" }

  router.post("/login", loginLimiter, async (req, res) => {
    const { email, password } = credentials.parse(req.body)
    const { token, maxAge, user } = await service.login(email, password)
    res.cookie(sessionCookie, token, { ...cookieOptions, maxAge }).json({ user })
  })
  router.get("/me", authenticate, (req, res) => res.json({ user: req.user }))
  router.post("/logout", authenticate, async (req, res) => {
    await service.logout(req.sessionId)
    res.clearCookie(sessionCookie, cookieOptions).sendStatus(204)
  })
  return router
}

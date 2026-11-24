import { Router } from "express"
import { z } from "zod"
import { HttpError } from "../../errors.js"
import { readSessionCookie, sessionCookie } from "./auth.middleware.js"

const credentials = z.object({ email: z.email().max(254), password: z.string().min(1).max(128) })

export function authController(service, authenticate, loginLimiter, secure) {
  const router = Router()
  const cookieOptions = { httpOnly: true, sameSite: "strict", secure, path: "/api" }

  router.post("/login", loginLimiter, async (req, res) => {
    const { email, password } = credentials.parse(req.body)
    const { token, maxAge, user } = await service.login(email, password)
    if (req.get("x-dnc-workspace") === "1") res.cookie(sessionCookie, token, { ...cookieOptions, maxAge })
    res.json({ user, accessToken: token, tokenType: "Bearer" })
  })
  router.post("/session", async (req, res) => {
    if (req.get("x-dnc-workspace") !== "1") throw new HttpError(403, "This action requires the workspace.")
    const token = readSessionCookie(req)
    if (!token) throw new HttpError(401, "Sign in to continue.")
    const { user } = await service.authenticate(token)
    res.json({ user, accessToken: token, tokenType: "Bearer" })
  })
  router.get("/me", authenticate, (req, res) => res.json({ user: req.user }))
  router.post("/logout", authenticate, async (req, res) => {
    await service.logout(req.sessionId)
    res.clearCookie(sessionCookie, cookieOptions).sendStatus(204)
  })
  return router
}

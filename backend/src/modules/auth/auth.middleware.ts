import type { Request, RequestHandler } from "express"
import type { Permission } from "../../permissions.ts"
import { HttpError } from "../../errors.ts"
import type { authService } from "./auth.service.ts"

export const sessionCookie = "dnc_session"

function bearerToken(req: Request) {
  return /^Bearer ([^\s,]+)$/i.exec(req.get("authorization") || "")?.[1]
}

function readSessionCookie(req: Request) {
  return (req.get("cookie") || "").split(";").map(value => value.trim())
    .find(value => value.startsWith(`${sessionCookie}=`))?.slice(sessionCookie.length + 1)
}

export function sessionAuth(
  service: ReturnType<typeof authService>,
  invalidSessionLimiter: RequestHandler,
  source: "bearer" | "cookie" = "bearer",
): RequestHandler {
  return async (req, res, next) => {
    if (source === "cookie" && req.get("x-dnc-workspace") !== "1") {
      throw new HttpError(403, "This action requires the workspace.")
    }
    const token = source === "cookie" ? readSessionCookie(req) : bearerToken(req)
    if (!token) {
      if (source === "cookie") throw new HttpError(401, "Sign in to continue.")
      res.set("WWW-Authenticate", "Bearer")
      throw new HttpError(401, "A bearer token is required.")
    }
    try {
      Object.assign(req, await service.authenticate(token))
    } catch (error) {
      if (error instanceof HttpError && error.status === 401) {
        return invalidSessionLimiter(req, res, () => next(error))
      }
      throw error
    }
    if (source === "cookie") req.sessionToken = token
    next()
  }
}

export function allow(...permissions: Permission[]): RequestHandler {
  return (req, res, next) => {
    if (!permissions.every(permission => req.user.permissions.includes(permission))) {
      throw new HttpError(403, "You do not have access to this action.")
    }
    next()
  }
}

export const superAdmin: RequestHandler = (req, _res, next) => {
  if (!req.user.isSuperAdmin) throw new HttpError(403, "Super Admin access is required.")
  next()
}

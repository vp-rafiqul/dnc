import { HttpError } from "../../errors.js"

export const sessionCookie = "dnc_session"

export function sessionAuth(service) {
  return async (req, res, next) => {
    const cookie = (req.get("cookie") || "").split(";").map(value => value.trim())
      .find(value => value.startsWith(`${sessionCookie}=`))
    if (!cookie) throw new HttpError(401, "Sign in to continue.")
    Object.assign(req, await service.authenticate(cookie.slice(sessionCookie.length + 1)))
    next()
  }
}

export function browserMutation(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next()
  if (req.get("x-dnc-workspace") !== "1" || req.get("sec-fetch-site") === "cross-site") {
    throw new HttpError(403, "This action requires the workspace.")
  }
  next()
}

export function allow(...permissions) {
  return (req, res, next) => {
    if (!permissions.every(permission => req.user.permissions.includes(permission))) {
      throw new HttpError(403, "You do not have access to this action.")
    }
    next()
  }
}

export function superAdmin(req, res, next) {
  if (!req.user.isSuperAdmin) throw new HttpError(403, "Super Admin access is required.")
  next()
}

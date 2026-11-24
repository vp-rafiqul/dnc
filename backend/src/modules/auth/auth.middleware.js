import { HttpError } from "../../errors.js"

export const sessionCookie = "dnc_session"

function bearerToken(req) {
  return /^Bearer ([^\s,]+)$/i.exec(req.get("authorization") || "")?.[1]
}

export function readSessionCookie(req) {
  return (req.get("cookie") || "").split(";").map(value => value.trim())
    .find(value => value.startsWith(`${sessionCookie}=`))?.slice(sessionCookie.length + 1)
}

export function sessionAuth(service) {
  return async (req, res, next) => {
    const token = bearerToken(req)
    if (!token) {
      res.set("WWW-Authenticate", "Bearer")
      throw new HttpError(401, "A bearer token is required.")
    }
    Object.assign(req, await service.authenticate(token))
    next()
  }
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

import { HttpError } from "../errors.js"

export function browserCors(frontendOrigin) {
  return (req, res, next) => {
    res.vary("Origin")
    const origin = req.get("origin")
    if (!origin) return next()
    if (origin !== frontendOrigin) throw new HttpError(403, "This origin is not allowed to use the API.")

    res.set({
      "Access-Control-Allow-Origin": frontendOrigin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Expose-Headers": "X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After",
    })
    if (req.method !== "OPTIONS") return next()
    res.set({
      "Access-Control-Allow-Methods": "GET, HEAD, POST, PATCH, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, X-API-Key, X-DNC-Workspace",
    }).sendStatus(204)
  }
}

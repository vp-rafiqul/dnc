export function keyAuth(service) {
  return async (req, res, next) => {
    req.user = await service.authenticate(req.get("x-api-key"))
    next()
  }
}

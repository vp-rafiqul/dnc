export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function errorMiddleware(error, req, res, next) {
  if (res.headersSent) return next(error)
  if (error.name === "ZodError") {
    return res.status(400).json({ error: error.issues[0]?.message || "Invalid input." })
  }
  if (error.code === "23505") return res.status(409).json({ error: "That entry already exists." })
  if (error.code === "23503") return res.status(400).json({ error: "The selected role is unavailable." })
  if (error.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON." })
  if (error.type === "entity.too.large") return res.status(413).json({ error: "Request is too large." })
  if (error instanceof HttpError) return res.status(error.status).json({ error: error.message })

  console.error("Request failed", { code: error.code, name: error.name })
  res.status(500).json({ error: "The request could not be completed." })
}

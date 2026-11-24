import type { NextFunction, Request, Response } from "express"
import { ZodError } from "zod"

export class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function errorMiddleware(error: unknown, _req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) return next(error)
  if (error instanceof ZodError) {
    return res.status(400).json({ error: error.issues[0]?.message || "Invalid input." })
  }
  if (error instanceof HttpError) return res.status(error.status).json({ error: error.message })
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined
  const type = error && typeof error === "object" && "type" in error ? error.type : undefined
  if (code === "23505") return res.status(409).json({ error: "That entry already exists." })
  if (code === "23503") return res.status(400).json({ error: "The selected role is unavailable." })
  if (type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON." })
  if (type === "entity.too.large") return res.status(413).json({ error: "Request is too large." })

  console.error("Request failed", { code, name: error instanceof Error ? error.name : undefined })
  res.status(500).json({ error: "The request could not be completed." })
}

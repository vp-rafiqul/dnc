import type { Principal } from "../../../shared/contracts.ts"

declare global {
  namespace Express {
    interface Request {
      // Set by the session or API key authentication middleware on protected routes.
      user: Principal
      sessionId: string
      sessionToken: string
      apiKeyId: string
    }
  }
}

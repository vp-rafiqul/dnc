import { z } from "zod"
import { HttpError } from "../../errors.js"

export function normalizePhone(input) {
  const value = input.trim()
  if (!/^(?:\+?1[ .-]?)?(?:\([2-9]\d{2}\)|[2-9]\d{2})[ .-]?[2-9]\d{2}[ .-]?\d{4}$/.test(value)) {
    throw new HttpError(400, "Enter a valid 10-digit US phone number, optionally with +1.")
  }
  return value.replace(/\D/g, "").slice(-10)
}

export function screeningService(repository, historySearch) {
  return {
    async check(userId, body, channel) {
      const { phone } = z.object({ phone: z.string().max(40) }).parse(body)
      const digits = normalizePhone(phone)
      const tokens = historySearch.tokensFor(userId, digits)
      const match = await repository.lookup(userId, digits, `+1 ••• ••• ${digits.slice(-4)}`, channel, tokens)
      if (!match) throw new HttpError(503, "The synthetic dataset is unavailable.")
      return {
        phone: `+1${digits}`,
        exists: match.exists_in_registry,
        federalMatch: match.jurisdictions.includes("FEDERAL"),
        stateMatches: match.jurisdictions.filter(value => value !== "FEDERAL"),
        source: "synthetic",
        generation: match.id,
        publishedAt: match.published_at,
        checkedAt: match.checked_at,
      }
    },
  }
}

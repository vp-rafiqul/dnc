import { z } from "zod"
import { HttpError } from "../../errors.js"

const filterInput = z.object({
  from: z.iso.datetime().optional(),
  until: z.iso.datetime().optional(),
  channel: z.enum(["web", "api"]).optional(),
  phone: z.string().trim().min(1).max(40).regex(/^[\d+().\-\s]+$/, "Enter phone digits. Spaces, +, parentheses, dots and hyphens are allowed.").optional(),
})
const pageInput = filterInput.extend({
  page: z.int32().positive().default(1),
  pageSize: z.int32().min(1).max(100).default(10),
})

export function historyService(repository, search) {
  function filters(userId, { from, until, channel, phone }) {
    if (from && until && Date.parse(from) >= Date.parse(until)) {
      throw new HttpError(400, "The end date must be on or after the start date.")
    }
    if (!phone) return { from, until, channel }

    let digits = phone.replace(/\D/g, "")
    if (digits.length > 1 && (phone.startsWith("+1") || (digits.length === 11 && digits.startsWith("1")))) {
      digits = digits.slice(1)
    }
    if (digits.length < 1 || digits.length > 10) throw new HttpError(400, "Enter up to 10 phone digits, with an optional +1.")
    return { from, until, channel, digits, token: search.token(userId, digits) }
  }

  return {
    async recent(userId) {
      const result = await repository.page(userId, {}, 1, 50)
      return result.items
    },
    async page(userId, body) {
      const { page, pageSize, ...input } = pageInput.parse(body ?? {})
      return repository.page(userId, filters(userId, input), page, pageSize)
    },
    report(userId, body, signal) {
      return repository.report(userId, filters(userId, filterInput.parse(body ?? {})), signal)
    },
  }
}

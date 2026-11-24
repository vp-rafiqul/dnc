import { z } from "zod"
import { HttpError } from "../../errors.ts"
import type { HistoryFilters } from "../../../../shared/contracts.ts"
import type { historyRepository, SearchFilters } from "./history.repository.ts"
import type { historySearch } from "./history-search.ts"

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

export function historyService(repository: ReturnType<typeof historyRepository>, search: ReturnType<typeof historySearch>) {
  function filters(userId: string, { from, until, channel, phone }: HistoryFilters): SearchFilters {
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
    async recent(userId: string) {
      const result = await repository.page(userId, {}, 1, 50)
      return result.items
    },
    async page(userId: string, body: unknown) {
      const { page, pageSize, ...input } = pageInput.parse(body ?? {})
      return repository.page(userId, filters(userId, input), page, pageSize)
    },
    report(userId: string, body: unknown, signal: AbortSignal) {
      return repository.report(userId, filters(userId, filterInput.parse(body ?? {})), signal)
    },
  }
}

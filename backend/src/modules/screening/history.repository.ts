import type { Database, Transaction } from "../../db/prisma.ts"
import type { Prisma } from "../../generated/prisma/client.ts"
import type { HistoryFilters, HistoryItem, HistoryPageData } from "../../../../shared/contracts.ts"

export type SearchFilters = Omit<HistoryFilters, "phone"> & { token?: string; digits?: string }

const select = {
  id: true, generation_id: true, masked_phone: true, exists_in_registry: true, channel: true, checked_at: true,
} satisfies Prisma.ScreeningEventSelect
const orderBy = [{ checked_at: "desc" }, { id: "desc" }] satisfies Prisma.ScreeningEventOrderByWithRelationInput[]
type HistoryRow = Prisma.ScreeningEventGetPayload<{ select: typeof select }>

function whereHistory(userId: string, { from, until, channel, token, digits }: SearchFilters): Prisma.ScreeningEventWhereInput {
  return {
    user_id: userId,
    checked_at: from || until ? { gte: from, lt: until } : undefined,
    channel,
    OR: token && digits ? [
      { phone_search_tokens: { has: token } },
      { legacy_phone_suffix: { contains: digits } },
    ] : undefined,
  }
}

function toHistoryItem(row: HistoryRow): HistoryItem<Date> {
  return { ...row, channel: row.channel === "api" ? "api" : "web" }
}

async function* reportRows(tx: Transaction, where: Prisma.ScreeningEventWhereInput, signal: AbortSignal) {
  const batchSize = 500
  let cursor: string | undefined
  while (!signal.aborted) {
    const batch: HistoryRow[] = await tx.screeningEvent.findMany({
      where, select, orderBy, take: batchSize,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
    })
    for (const row of batch) {
      if (signal.aborted) return
      yield toHistoryItem(row)
    }
    if (batch.length < batchSize) return
    cursor = batch[batch.length - 1].id
  }
}

export function historyRepository(db: Database) {
  return {
    async page(userId: string, filters: SearchFilters, page: number, pageSize: number): Promise<HistoryPageData> {
      const where = whereHistory(userId, filters)
      return db.$transaction(async tx => {
        const total = await tx.screeningEvent.count({ where })
        const current = Math.min(page, Math.max(1, Math.ceil(total / pageSize)))
        const rows = await tx.screeningEvent.findMany({ where, select, orderBy, skip: (current - 1) * pageSize, take: pageSize })
        const items = rows.map(row => ({ ...toHistoryItem(row), checked_at: row.checked_at.toISOString() }))
        return { items, total, page: current, pageSize }
      }, { isolationLevel: "RepeatableRead" })
    },
    report(userId: string, filters: SearchFilters, signal: AbortSignal, write: (rows: AsyncIterable<HistoryItem<Date>>) => Promise<void>) {
      const where = whereHistory(userId, filters)
      return db.$transaction(tx => write(reportRows(tx, where, signal)), {
        isolationLevel: "RepeatableRead", timeout: 5 * 60_000,
      })
    },
  }
}

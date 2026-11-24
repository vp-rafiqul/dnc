import type { Pool } from "pg"
import type { HistoryFilters, HistoryItem, HistoryPageData } from "../../../../shared/contracts.ts"

export type SearchFilters = Omit<HistoryFilters, "phone"> & { token?: string; digits?: string }
type PageRow = Pick<HistoryPageData, "items"> & { total: string; page: string }
type ReportRow = HistoryItem<Date> & { cursor_time: string }

const reportFields = "id, generation_id, masked_phone, exists_in_registry, channel, checked_at"
const filterSql = `user_id = $1
  AND ($2::timestamptz IS NULL OR checked_at >= $2)
  AND ($3::timestamptz IS NULL OR checked_at < $3)
  AND ($4::text IS NULL OR channel = $4)
  AND ($5::text IS NULL OR $5 = ANY(phone_search_tokens)
    OR (phone_search_tokens IS NULL AND strpos(right(masked_phone, 4), $6::text) > 0))`

function filterParams(userId: string, { from, until, channel, token, digits }: SearchFilters) {
  return [userId, from ?? null, until ?? null, channel ?? null, token ?? null, digits ?? null]
}

export function historyRepository(db: Pool) {
  return {
    async page(userId: string, filters: SearchFilters, page: number, pageSize: number): Promise<HistoryPageData> {
      const { rows: [result] } = await db.query<PageRow>(`WITH filtered AS NOT MATERIALIZED (
        SELECT ${reportFields} FROM screening_events WHERE ${filterSql}
      ), totals AS (
        SELECT count(*) AS total FROM filtered
      ), pagination AS (
        SELECT total, least($7::integer, greatest(1, (total + $8::integer - 1) / $8)) AS page FROM totals
      )
      SELECT total, page, COALESCE((
        SELECT json_agg(batch ORDER BY batch.checked_at DESC, batch.id DESC) FROM (
          SELECT * FROM filtered ORDER BY checked_at DESC, id DESC
          OFFSET ((pagination.page - 1) * $8) LIMIT $8
        ) batch
      ), '[]') AS items FROM pagination`, [...filterParams(userId, filters), page, pageSize])
      return { items: result.items, total: Number(result.total), page: Number(result.page), pageSize }
    },
    async *report(userId: string, filters: SearchFilters, signal: AbortSignal): AsyncGenerator<HistoryItem<Date>> {
      const client = await db.connect()
      try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
        const params = filterParams(userId, filters)
        let cursorTime: string | null = null
        let cursorId: string | null = null
        while (!signal.aborted) {
          const rows: ReportRow[] = (await client.query<ReportRow>(`SELECT ${reportFields}, checked_at::text AS cursor_time
            FROM screening_events WHERE ${filterSql}
              AND ($7::timestamptz IS NULL OR (checked_at, id) < ($7::timestamptz, $8::uuid))
            ORDER BY checked_at DESC, id DESC LIMIT 500`, [...params, cursorTime, cursorId])).rows
          for (const { cursor_time, ...row } of rows) {
            if (signal.aborted) break
            yield row
          }
          if (rows.length < 500) break
          const last = rows[rows.length - 1]
          cursorTime = last.cursor_time
          cursorId = last.id
        }
        await client.query("COMMIT")
      } catch (error) {
        await client.query("ROLLBACK")
        throw error
      } finally {
        client.release()
      }
    },
  }
}


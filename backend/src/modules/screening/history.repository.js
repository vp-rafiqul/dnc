const reportFields = "id, generation_id, masked_phone, exists_in_registry, channel, checked_at"
const filterSql = `user_id = $1
  AND ($2::timestamptz IS NULL OR checked_at >= $2)
  AND ($3::timestamptz IS NULL OR checked_at < $3)
  AND ($4::text IS NULL OR channel = $4)
  AND ($5::text IS NULL OR $5 = ANY(phone_search_tokens)
    OR (phone_search_tokens IS NULL AND strpos(right(masked_phone, 4), $6::text) > 0))`

function filterParams(userId, { from, until, channel, token, digits }) {
  return [userId, from ?? null, until ?? null, channel ?? null, token ?? null, digits ?? null]
}

export function historyRepository(db) {
  return {
    async page(userId, filters, page, pageSize) {
      const { rows: [result] } = await db.query(`WITH filtered AS NOT MATERIALIZED (
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
    async *report(userId, filters, signal) {
      const client = await db.connect()
      try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
        const params = filterParams(userId, filters)
        let cursorTime = null
        let cursorId = null
        while (!signal.aborted) {
          const { rows } = await client.query(`SELECT ${reportFields}, checked_at::text AS cursor_time
            FROM screening_events WHERE ${filterSql}
              AND ($7::timestamptz IS NULL OR (checked_at, id) < ($7::timestamptz, $8::uuid))
            ORDER BY checked_at DESC, id DESC LIMIT 500`, [...params, cursorTime, cursorId])
          for (const { cursor_time, ...row } of rows) {
            if (signal.aborted) break
            yield row
          }
          if (rows.length < 500) break
          const last = rows.at(-1)
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

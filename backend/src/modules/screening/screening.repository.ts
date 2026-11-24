import type { Pool } from "pg"
import type { Channel } from "../../../../shared/contracts.ts"

interface MatchRow {
  id: string
  published_at: Date
  jurisdictions: string[]
  checked_at: Date
  exists_in_registry: boolean
}

export function screeningRepository(db: Pool) {
  return {
    async lookup(userId: string, phone: string, masked: string, channel: Channel, searchTokens: string[]): Promise<MatchRow | undefined> {
      const { rows } = await db.query<MatchRow>(`WITH matches AS (
        SELECT g.id, g.published_at,
          COALESCE(array_agg(n.jurisdiction ORDER BY n.jurisdiction)
            FILTER (WHERE n.jurisdiction IS NOT NULL), '{}') AS jurisdictions
        FROM registry_generations g
        LEFT JOIN registry_numbers n ON n.generation_id = g.id AND n.phone = $2
        WHERE g.active
        GROUP BY g.id
      ), recorded AS (
        INSERT INTO screening_events (user_id, generation_id, masked_phone, exists_in_registry, channel, phone_search_tokens)
        SELECT $1, id, $3, cardinality(jurisdictions) > 0, $4, $5 FROM matches
        RETURNING generation_id, checked_at, exists_in_registry
      )
      SELECT matches.*, recorded.checked_at, recorded.exists_in_registry
      FROM recorded JOIN matches ON matches.id = recorded.generation_id`, [userId, phone, masked, channel, searchTokens])
      return rows[0]
    },
  }
}

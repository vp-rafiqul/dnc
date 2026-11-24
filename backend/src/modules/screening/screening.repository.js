export function screeningRepository(db) {
  return {
    async lookup(userId, phone, masked, channel) {
      const { rows } = await db.query(`WITH matches AS (
        SELECT g.id, g.published_at,
          COALESCE(array_agg(n.jurisdiction ORDER BY n.jurisdiction)
            FILTER (WHERE n.jurisdiction IS NOT NULL), '{}') AS jurisdictions
        FROM registry_generations g
        LEFT JOIN registry_numbers n ON n.generation_id = g.id AND n.phone = $2
        WHERE g.active
        GROUP BY g.id
      ), recorded AS (
        INSERT INTO screening_events (user_id, generation_id, masked_phone, exists_in_registry, channel)
        SELECT $1, id, $3, cardinality(jurisdictions) > 0, $4 FROM matches
        RETURNING generation_id, checked_at, exists_in_registry
      )
      SELECT matches.*, recorded.checked_at, recorded.exists_in_registry
      FROM recorded JOIN matches ON matches.id = recorded.generation_id`, [userId, phone, masked, channel])
      return rows[0]
    },
    async recent(userId) {
      return (await db.query(`SELECT id, generation_id, masked_phone, exists_in_registry, channel, checked_at
        FROM screening_events WHERE user_id = $1 ORDER BY checked_at DESC, id DESC LIMIT 50`, [userId])).rows
    },
  }
}

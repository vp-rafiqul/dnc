import type { Database } from "../../db/prisma.ts"
import type { Channel } from "../../../../shared/contracts.ts"

export function screeningRepository(db: Database) {
  return {
    async lookup(userId: string, phone: string, masked: string, channel: Channel, searchTokens: string[]) {
      return db.$transaction(async tx => {
        const generation = await tx.registryGeneration.findFirst({
          where: { active: true },
          select: {
            id: true, published_at: true,
            numbers: { where: { phone }, select: { jurisdiction: true }, orderBy: { jurisdiction: "asc" } },
          },
        })
        if (!generation) return undefined
        const jurisdictions = generation.numbers.map(number => number.jurisdiction)
        const entry = await tx.screeningEvent.create({
          data: {
            user_id: userId, generation_id: generation.id, masked_phone: masked,
            exists_in_registry: jurisdictions.length > 0, channel, phone_search_tokens: searchTokens,
          },
          select: { checked_at: true, exists_in_registry: true },
        })
        return { id: generation.id, published_at: generation.published_at, jurisdictions, ...entry }
      }, { isolationLevel: "RepeatableRead" })
    },
  }
}

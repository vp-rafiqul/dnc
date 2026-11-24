import { PrismaPg } from "@prisma/adapter-pg"
import { Prisma, PrismaClient } from "../generated/prisma/client.ts"

export function createDatabase(connectionString: string) {
  const schema = new URL(connectionString).searchParams.get("schema") ?? undefined
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 5000 }, { schema }) })
}

export type Database = ReturnType<typeof createDatabase>
export type Transaction = Prisma.TransactionClient

export async function serializable<T>(db: Database, work: (transaction: Transaction) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.$transaction(work, { isolationLevel: "Serializable" })
    } catch (error) {
      if (attempt >= 5 || !(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034") throw error
    }
  }
}

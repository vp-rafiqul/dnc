import { z } from "zod"
import { hashPassword } from "../modules/auth/auth.service.ts"
import { createDatabase, serializable } from "./prisma.ts"

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error("Set DATABASE_URL in backend/.env")
const db = createDatabase(databaseUrl)
const generationId = "synthetic-v1"
const registry = [
  ["2125550100", "FEDERAL"], ["2125550100", "NY"], ["3055550123", "FL"], ["3055550123", "TX"],
  ["2025550111", "FEDERAL"], ["3125550175", "IL"], ["6175550132", "FEDERAL"],
  ["7135550142", "TX"], ["2065550169", "FEDERAL"], ["2065550169", "WA"],
]

try {
  await serializable(db, async tx => {
    await tx.role.createMany({ data: [{ name: "Super Admin", is_super_admin: true }], skipDuplicates: true })
    const role = await tx.role.findFirst({ where: { is_super_admin: true }, select: { id: true } })
    if (!role) throw new Error("The Super Admin role could not be seeded")
    if (!await tx.user.findFirst({ where: { role_id: role.id }, select: { id: true } })) {
      const email = z.email().max(254).safeParse(process.env.ADMIN_EMAIL?.trim().toLowerCase())
      const password = process.env.ADMIN_PASSWORD
      if (!email.success || !password || password.length < 12 || password.length > 128) {
        throw new Error("Set a valid ADMIN_EMAIL and a 12–128 character ADMIN_PASSWORD in backend/.env")
      }
      await tx.user.create({ data: {
        name: "Workspace Admin", email: email.data, password_hash: await hashPassword(password), role_id: role.id,
      } })
    }
    const active = await tx.registryGeneration.findFirst({ where: { active: true }, select: { id: true } })
    await tx.registryGeneration.createMany({ data: [{ id: generationId, active: !active }], skipDuplicates: true })
    await tx.registryNumber.createMany({
      data: registry.map(([phone, jurisdiction]) => ({ generation_id: generationId, phone, jurisdiction })),
      skipDuplicates: true,
    })
  })
  console.log("Super Admin and synthetic screening data are ready.")
} finally {
  await db.$disconnect()
}

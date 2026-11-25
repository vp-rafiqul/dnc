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

const states: [string, string][] = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"], ["CO", "Colorado"],
  ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"],
  ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"],
  ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"],
  ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"],
  ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"],
  ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"],
  ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"], ["SD", "South Dakota"],
  ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"],
  ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
]
// A starter set covering the synthetic registry; admins add the remaining area codes under Billing.
const starterAreaCodes: [string, string][] = [
  ["212", "NY"], ["718", "NY"], ["305", "FL"], ["786", "FL"], ["415", "CA"], ["213", "CA"], ["202", "DC"],
  ["312", "IL"], ["617", "MA"], ["713", "TX"], ["214", "TX"], ["206", "WA"],
]

try {
  await serializable(db, async tx => {
    await tx.coverageState.createMany({ data: states.map(([code, name]) => ({ code, name })), skipDuplicates: true })
    await tx.coverageAreaCode.createMany({
      data: starterAreaCodes.map(([area_code, state_code]) => ({ area_code, state_code })), skipDuplicates: true,
    })
    await tx.billingSettings.createMany({ data: [{ id: 1 }], skipDuplicates: true })
    if (!await tx.role.findFirst({ where: { is_self_service: true }, select: { id: true } })) {
      const name = await tx.role.findFirst({ where: { name: { equals: "Seller", mode: "insensitive" } }, select: { id: true } })
        ? "Self-registered seller" : "Seller"
      await tx.role.create({ data: { name, is_self_service: true, permissions: ["page.seller", "seller.manage"] } })
    }
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

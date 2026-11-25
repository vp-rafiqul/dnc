import { createHash, randomUUID } from "node:crypto"
import { z } from "zod"
import { HttpError } from "../../errors.ts"
import type { Prisma } from "../../generated/prisma/client.ts"
import type {
  AuthorizationScope, ConsentText, Principal, SellerAuthorizationRecord, SellerCoverageRecord, SellerEventRecord,
  SellerNoticeRecord, SellerOverview, SellerProfile, SellerReviewDetail, SellerReviewSummary, SellerSubscriptionRecord,
  SellerSubscriptionStatus, SellerVerificationRecord, SellerVerificationResult,
} from "../../../../shared/contracts.ts"
import type { Decision, sellersRepository } from "./sellers.repository.ts"
import { maskSan } from "./san-vault.ts"
import { toPayment } from "../billing/billing.service.ts"
import type { sanVault } from "./san-vault.ts"

const day = 86_400_000
const maxAuthorizationDays = 400

export const authorizationScopes: Record<AuthorizationScope, string> = {
  registry_access: "Access the National Do Not Call Registry using our SAN",
  number_screening: "Screen telephone numbers against the registry on our behalf",
}

export const consentText: ConsentText = {
  version: "2026-11-seller-authorization-v1",
  text: "I confirm that I am authorized to act for the seller named in this profile. The seller authorizes the operator "
    + "of this workspace, acting as its telemarketing service provider, to use the seller's Subscription Account Number (SAN) "
    + "only for the permitted scope selected below. This authorization ends on the expiration date or when the seller revokes it "
    + "through the selected revocation channel, whichever comes first. I agree to sign electronically, and my typed name is my signature.",
}
const consentDigest = createHash("sha256").update(consentText.text).digest("hex")

const text = (min: number, max: number) => z.string().trim().min(min).max(max)
const areaCode = z.string().trim().regex(/^[2-9][0-8][0-9]$/, "Enter 3-digit US area codes such as 212.")
  .refine(code => !code.endsWith("11"), "N11 service codes are not area codes.")
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.")
  .transform((value, context) => {
    const parsed = new Date(`${value}T00:00:00.000Z`)
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      context.addIssue({ code: "custom", message: "Enter a valid date." })
      return z.NEVER
    }
    return parsed
  })
// SANs are opaque FTC identifiers. Format checks only reject typos; they never imply the SAN is valid or active.
const san = z.string().max(64).transform(value => value.replace(/[\s-]/g, "").toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9]{5,32}$/, "Enter the SAN exactly as the FTC issued it (5–32 letters or digits)."))

const profileInput = z.object({
  legalName: text(2, 200),
  organizationId: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9 ./-]{1,39}$/, "Enter the organization ID, such as an EIN (2–40 characters)."),
  representative: z.object({
    name: text(2, 120),
    title: text(2, 120),
    email: z.email("Enter the representative's email address.").max(254).transform(value => value.toLowerCase()),
    phone: z.string().trim().regex(/^\+?[0-9 ().-]{7,25}$/, "Enter the representative's phone number."),
  }),
})
const createInput = profileInput.extend({ san })
const updateInput = profileInput.extend({ san: san.optional() })

const authorizationInput = z.object({
  signerName: text(2, 120),
  signerTitle: text(2, 120),
  signerEmail: z.email().max(254).transform(value => value.toLowerCase()),
  permittedScope: z.array(z.enum(Object.keys(authorizationScopes) as [AuthorizationScope, ...AuthorizationScope[]]))
    .min(1, "Select at least one permitted scope.").transform(scope => [...new Set(scope)]),
  expiresOn: date,
  revocationChannel: z.enum(["in_app", "email"]),
  revocationContact: z.email().max(254).optional(),
  consentTextVersion: z.literal(consentText.version, "The authorization text changed. Reload the page and review it again."),
  electronicSignatureConsent: z.literal(true, "Agree to sign electronically to continue."),
}).refine(input => input.revocationChannel !== "email" || input.revocationContact, {
  message: "Enter the email address that receives revocations.", path: ["revocationContact"],
})
const revokeInput = z.object({ reason: text(1, 500).optional() })

const check = z.enum(["confirmed", "mismatch", "unclear"])
const verificationInput = z.object({
  decision: z.enum(["verify", "reject"]),
  ftcReference: text(1, 120).optional(),
  checkedOn: date.optional(),
  // The reviewer attests that they checked the seller in the FTC service-provider client; the reference is then optional.
  attested: z.boolean().optional(),
  identity: check,
  sanPeriod: check,
  areaCodes: check,
  sanPeriodStart: date.optional(),
  sanPeriodEnd: date.optional(),
  confirmedAreaCodes: z.array(areaCode).max(400).optional().transform(codes => [...new Set(codes ?? [])].sort()),
  evidenceLocation: text(1, 500).optional(),
  notes: text(1, 2000).optional(),
}).refine(input => input.decision !== "reject" || input.notes, { message: "Explain the rejection in the notes.", path: ["notes"] })
type VerificationInput = z.infer<typeof verificationInput>

const checkLabels = {
  identity: "seller identity (legal name and organization ID)",
  sanPeriod: "SAN subscription period",
  areaCodes: "subscribed area codes",
} as const

// Verification is derived only from reviewer evidence: an explicit mismatch rejects, anything missing or uncertain needs review.
export function decideVerification(input: VerificationInput, authorization: { expires_at: Date; permitted_scope: string[] } | null, now: Date,
  payment: { paidAt: Date | null; paidThrough: Date | null } = { paidAt: null, paidThrough: null }) {
  const checks = (Object.keys(checkLabels) as (keyof typeof checkLabels)[])
  const periodStart = input.sanPeriodStart ?? null
  const periodEnd = input.sanPeriodEnd ? new Date(input.sanPeriodEnd.getTime() + day) : null
  const base = { periodStart, periodEnd, areaCodes: input.confirmedAreaCodes }
  if (input.decision === "reject") return { ...base, outcome: "REJECTED" as const, reasons: [`Rejected by reviewer: ${input.notes}`] }
  const mismatches = checks.filter(key => input[key] === "mismatch")
  if (mismatches.length) {
    return { ...base, outcome: "REJECTED" as const, reasons: mismatches.map(key => `The FTC record does not match the ${checkLabels[key]}.`) }
  }
  const reasons = checks.filter(key => input[key] === "unclear").map(key => `The ${checkLabels[key]} could not be confirmed.`)
  if (!input.ftcReference && !input.attested) reasons.push("The FTC service-provider confirmation reference is missing.")
  if (!input.checkedOn) reasons.push("The date of the FTC check is missing.")
  else if (input.checkedOn.getTime() > now.getTime()) reasons.push("The FTC check date is in the future.")
  if (!periodStart || !periodEnd || periodEnd <= periodStart) reasons.push("The SAN period dates are missing or invalid.")
  else if (periodEnd <= now) reasons.push("The SAN period has already ended.")
  if (!input.confirmedAreaCodes.length) reasons.push("No subscribed area codes were confirmed.")
  if (!payment.paidAt || !payment.paidThrough) reasons.push("The subscription has not been paid.")
  else if (payment.paidThrough <= now) reasons.push("The paid billing period has ended.")
  else if (periodStart && payment.paidThrough <= periodStart) reasons.push("The paid billing period ends before the SAN period starts.")
  if (!authorization) reasons.push("The seller has no active authorization.")
  else {
    if (!authorization.permitted_scope.includes("registry_access")) reasons.push("The authorization does not permit registry access.")
    if (periodStart && authorization.expires_at <= periodStart) reasons.push("The authorization expires before the SAN period starts.")
  }
  return { ...base, outcome: reasons.length ? "REVIEW_REQUIRED" as const : "VERIFIED" as const, reasons }
}

type Repository = ReturnType<typeof sellersRepository>
type ProfileRow = NonNullable<Awaited<ReturnType<Repository["overview"]>>>
type DetailRow = NonNullable<Awaited<ReturnType<Repository["reviewDetail"]>>>
type AuthorizationRow = ProfileRow["authorizations"][number] & { evidence?: Prisma.JsonValue }
type SubscriptionRow = ProfileRow["subscriptions"][number]

const iso = (value: Date) => value.toISOString()
const isoOrNull = (value: Date | null) => value?.toISOString() ?? null
const jsonObject = (value: Prisma.JsonValue) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}

function toProfile(row: Pick<ProfileRow, keyof ProfileRow & `${string}`>): SellerProfile {
  return {
    id: row.id, legal_name: row.legal_name, organization_id: row.organization_id, masked_san: maskSan(row.san_last4),
    representative: { name: row.representative_name, title: row.representative_title, email: row.representative_email, phone: row.representative_phone },
    created_at: iso(row.created_at), updated_at: iso(row.updated_at),
  }
}

function toAuthorization(row: AuthorizationRow, now: Date): SellerAuthorizationRecord {
  return {
    id: row.id, signer_name: row.signer_name, signer_title: row.signer_title, signer_email: row.signer_email,
    signed_at: iso(row.signed_at), permitted_scope: row.permitted_scope as AuthorizationScope[], expires_at: iso(row.expires_at),
    revocation_channel: row.revocation_channel as SellerAuthorizationRecord["revocation_channel"],
    revocation_contact: row.revocation_contact, revoked_at: isoOrNull(row.revoked_at), revocation_reason: row.revocation_reason,
    active: !row.revoked_at && row.expires_at > now,
    ...row.evidence !== undefined && { evidence: jsonObject(row.evidence) },
  }
}

function toSubscription(row: SubscriptionRow): SellerSubscriptionRecord {
  return {
    id: row.id, status: row.status as SellerSubscriptionStatus, requested_area_codes: row.requested_area_codes,
    status_reason: row.status_reason, period_start: isoOrNull(row.period_start), period_end: isoOrNull(row.period_end),
    verified_at: isoOrNull(row.verified_at), next_review_at: isoOrNull(row.next_review_at), created_at: iso(row.created_at),
    coverage_scope: row.coverage_scope as SellerSubscriptionRecord["coverage_scope"], selected_states: row.selected_states,
    billing_cycle: row.billing_cycle as SellerSubscriptionRecord["billing_cycle"], amount_cents: row.amount_cents, currency: row.currency,
    paid_at: isoOrNull(row.paid_at), paid_through: isoOrNull(row.paid_through), payments: row.payments.map(toPayment),
  }
}

function toCoverage(rows: SubscriptionRow[], now: Date): SellerCoverageRecord[] {
  return rows.flatMap(subscription => subscription.coverage.map(row => ({
    subscription_id: row.subscription_id, area_code: row.area_code, valid_from: iso(row.valid_from), valid_until: iso(row.valid_until),
    ended_at: isoOrNull(row.ended_at), end_reason: row.end_reason,
    active: !row.ended_at && row.valid_from <= now && row.valid_until > now,
  })))
}

function toNotice(row: ProfileRow["notices"][number]): SellerNoticeRecord {
  return {
    id: row.id, subscription_id: row.subscription_id, kind: row.kind as SellerNoticeRecord["kind"],
    message: row.message, due_at: iso(row.due_at), delivered_at: isoOrNull(row.delivered_at),
  }
}

export function sellersService(repository: Repository, vault: ReturnType<typeof sanVault>) {
  function storeSan(sellerId: string, value: string) {
    const { keyId, ciphertext } = vault.encrypt(sellerId, value)
    return { keyId, ciphertext: new Uint8Array(ciphertext), last4: value.slice(-4) }
  }

  return {
    async overview(user: Principal): Promise<SellerOverview> {
      const now = new Date()
      const row = await repository.overview(user.id)
      return {
        profile: row ? toProfile(row) : null,
        authorization: row?.authorizations[0] ? toAuthorization(row.authorizations[0], now) : null,
        subscriptions: row?.subscriptions.map(toSubscription) ?? [],
        coverage: row ? toCoverage(row.subscriptions, now) : [],
        notices: row?.notices.map(toNotice) ?? [],
        consent: consentText,
        scopes: authorizationScopes,
      }
    },

    async create(user: Principal, body: unknown) {
      const input = createInput.parse(body)
      const sellerId = randomUUID()
      const created = await repository.create(user.id, sellerId, input, storeSan(sellerId, input.san))
      if (!created) throw new HttpError(409, "This account already has a seller profile.")
      return created
    },

    async update(user: Principal, body: unknown) {
      const input = updateInput.parse(body)
      let stored = null
      if (input.san) {
        const current = await repository.findSan(user.id)
        if (!current) throw new HttpError(404, "Create a seller profile first.")
        if (vault.decrypt(current.id, current.san_key_id, current.san_ciphertext) !== input.san) stored = storeSan(current.id, input.san)
      }
      const updated = await repository.update(user.id, input, stored)
      if (!updated) throw new HttpError(404, "Create a seller profile first.")
      return updated
    },

    async sign(user: Principal, body: unknown, request: { ip?: string; userAgent?: string }) {
      const input = authorizationInput.parse(body)
      const now = new Date()
      const expiresAt = new Date(input.expiresOn.getTime() + day)
      if (expiresAt.getTime() <= now.getTime() + day) throw new HttpError(400, "Choose an expiration date after tomorrow.")
      if (expiresAt.getTime() > now.getTime() + maxAuthorizationDays * day) {
        throw new HttpError(400, `Authorizations can last at most ${maxAuthorizationDays} days.`)
      }
      const authorization = await repository.sign(user.id, {
        signerName: input.signerName, signerTitle: input.signerTitle, signerEmail: input.signerEmail,
        permittedScope: input.permittedScope, expiresAt, revocationChannel: input.revocationChannel,
        revocationContact: input.revocationChannel === "email" ? input.revocationContact ?? null : null,
        evidence: {
          method: "typed_electronic_signature", consentTextVersion: consentText.version, consentTextSha256: consentDigest,
          consentText: consentText.text, typedSignature: input.signerName, electronicSignatureConsent: true,
          permittedScope: input.permittedScope.map(scope => authorizationScopes[scope]),
          accountId: user.id, accountEmail: user.email, ipAddress: request.ip ?? null, userAgent: request.userAgent?.slice(0, 500) ?? null,
        },
      })
      if (!authorization) throw new HttpError(404, "Create a seller profile first.")
      return authorization
    },

    async revoke(user: Principal, authorizationId: string, body: unknown) {
      const { reason } = revokeInput.parse(body ?? {})
      const revoked = await repository.revoke(user.id, authorizationId, reason ?? "Revoked by the seller in the workspace.")
      if (!revoked) throw new HttpError(404, "Active authorization not found.")
      return revoked
    },

    async reviewQueue(status?: string): Promise<SellerReviewSummary[]> {
      const now = new Date()
      const rows = await repository.reviewQueue()
      const summaries = rows.map(row => {
        const current = row.subscriptions.find(item => item.status === "PENDING" || item.status === "REVIEW_REQUIRED")
          ?? row.subscriptions.find(item => item.status === "VERIFIED") ?? row.subscriptions[0]
        return {
          id: row.id, legal_name: row.legal_name, organization_id: row.organization_id, masked_san: maskSan(row.san_last4),
          owner_email: row.owner.email, status: (current?.status ?? null) as SellerSubscriptionStatus | null,
          subscription_id: current?.id ?? null, authorization_active: row.authorizations.length > 0,
          review_due: row.subscriptions.some(item => item.status === "VERIFIED" && item.next_review_at !== null && item.next_review_at <= now),
          updated_at: iso(row.updated_at),
        }
      })
      if (status === "REVIEW_DUE") return summaries.filter(item => item.review_due)
      return status ? summaries.filter(item => item.status === status) : summaries
    },

    async reviewDetail(sellerId: string): Promise<SellerReviewDetail> {
      const now = new Date()
      const row: DetailRow | null = await repository.reviewDetail(sellerId)
      if (!row) throw new HttpError(404, "Seller not found.")
      const verifications: SellerVerificationRecord[] = row.subscriptions.flatMap(subscription => subscription.verifications.map(item => ({
        id: item.id, subscription_id: item.subscription_id, outcome: item.outcome as SellerVerificationRecord["outcome"],
        reviewer_name: item.reviewer_name, reviewer_email: item.reviewer_email,
        san_period_start: isoOrNull(item.san_period_start), san_period_end: isoOrNull(item.san_period_end),
        confirmed_area_codes: item.confirmed_area_codes, evidence: jsonObject(item.evidence), reasons: item.reasons, created_at: iso(item.created_at),
      }))).sort((a, b) => b.created_at.localeCompare(a.created_at))
      const events: SellerEventRecord[] = row.events.map(item => ({
        id: item.id, action: item.action, actor: item.actor?.email ?? null, detail: jsonObject(item.detail), created_at: iso(item.created_at),
      }))
      return {
        profile: toProfile(row), owner: row.owner,
        authorizations: row.authorizations.map(item => toAuthorization(item, now)),
        subscriptions: row.subscriptions.map(toSubscription),
        verifications, coverage: toCoverage(row.subscriptions, now),
        notices: row.notices.map(item => ({ ...toNotice(item), audience: item.audience })),
        events,
      }
    },

    async revealSan(reviewer: Principal, sellerId: string) {
      const seller = await repository.revealSan(sellerId, reviewer.id)
      if (!seller) throw new HttpError(404, "Seller not found.")
      return { san: vault.decrypt(seller.id, seller.san_key_id, seller.san_ciphertext) }
    },

    async verify(reviewer: Principal, subscriptionId: string, body: unknown): Promise<SellerVerificationResult> {
      const input = verificationInput.parse(body)
      const result = await repository.verify(subscriptionId, reviewer.id, ({ authorization, now, paidAt, paidThrough }): Decision => {
        const decision = decideVerification(input, authorization, now, { paidAt, paidThrough })
        return {
          ...decision,
          evidence: {
            method: input.attested && !input.ftcReference ? "reviewer_attestation" : "ftc_service_provider_client",
            decision: input.decision, attested: input.attested ?? false, ftcReference: input.ftcReference ?? null,
            checkedOn: input.checkedOn?.toISOString().slice(0, 10) ?? null,
            checks: { identity: input.identity, sanPeriod: input.sanPeriod, areaCodes: input.areaCodes },
            evidenceLocation: input.evidenceLocation ?? null, notes: input.notes ?? null,
            authorizationId: authorization?.id ?? null, authorizationExpiresAt: authorization?.expires_at.toISOString() ?? null,
          },
        }
      })
      if (result === "missing") throw new HttpError(404, "Subscription not found.")
      if (result === "self") throw new HttpError(403, "You cannot verify a seller profile that you own.")
      if (result === "closed") throw new HttpError(409, "This subscription is unpaid or closed. Only paid subscriptions can be verified.")
      return result
    },
  }
}

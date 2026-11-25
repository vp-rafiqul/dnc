import { serializable } from "../../db/prisma.ts"
import type { Database, Transaction } from "../../db/prisma.ts"
import type { Prisma, SellerAuthorization } from "../../generated/prisma/client.ts"
import { paymentSelect } from "../billing/billing.repository.ts"

const day = 86_400_000
const reviewIntervalDays = 90
const renewalNoticeDays = [60, 30, 7]
const isoDate = (value: Date) => value.toISOString().slice(0, 10)
const earliest = (...values: Date[]) => new Date(Math.min(...values.map(value => value.getTime())))

export function addCycle(from: Date, cycle: string) {
  const next = new Date(from)
  if (cycle === "yearly") next.setUTCFullYear(next.getUTCFullYear() + 1)
  else next.setUTCMonth(next.getUTCMonth() + 1)
  return next
}

export interface SellerIdentity {
  legalName: string
  organizationId: string
  representative: { name: string; title: string; email: string; phone: string }
}

export interface StoredSan {
  keyId: string
  ciphertext: Uint8Array<ArrayBuffer>
  last4: string
}

export interface AuthorizationData {
  signerName: string
  signerTitle: string
  signerEmail: string
  permittedScope: string[]
  expiresAt: Date
  revocationChannel: string
  revocationContact: string | null
  evidence: Prisma.InputJsonObject
}

export interface Decision {
  outcome: "VERIFIED" | "REJECTED" | "REVIEW_REQUIRED"
  reasons: string[]
  periodStart: Date | null
  periodEnd: Date | null
  areaCodes: string[]
  evidence: Prisma.InputJsonObject
}

function sellerFields(identity: SellerIdentity) {
  const { legalName, organizationId, representative } = identity
  return {
    legal_name: legalName, organization_id: organizationId,
    representative_name: representative.name, representative_title: representative.title,
    representative_email: representative.email, representative_phone: representative.phone,
  }
}

// A self-registered seller with at least one VERIFIED subscription gets the built-in Reseller role
// (screening, history, API keys, and its own users and roles). It moves back to the self-service Seller role
// when no verified subscription remains. Accounts given other roles by an admin are never changed.
export async function syncResellerAccess(client: Pick<Transaction, "$queryRaw">, sellerId: string | null = null) {
  const [result] = await client.$queryRaw<{ granted: number; removed: number }[]>`
    WITH reseller AS (SELECT id FROM roles WHERE is_reseller LIMIT 1),
    self_service AS (SELECT id FROM roles WHERE is_self_service LIMIT 1),
    verified AS (SELECT DISTINCT seller_id FROM seller_subscriptions WHERE status = 'VERIFIED'),
    granted AS (
      UPDATE users u SET role_id = (SELECT id FROM reseller)
      FROM sellers s
      WHERE s.owner_id = u.id AND (${sellerId}::uuid IS NULL OR s.id = ${sellerId}::uuid)
        AND u.role_id = (SELECT id FROM self_service) AND (SELECT id FROM reseller) IS NOT NULL
        AND s.id IN (SELECT seller_id FROM verified)
      RETURNING s.id AS seller_id
    ), removed AS (
      UPDATE users u SET role_id = (SELECT id FROM self_service)
      FROM sellers s
      WHERE s.owner_id = u.id AND (${sellerId}::uuid IS NULL OR s.id = ${sellerId}::uuid)
        AND s.reseller_access AND u.role_id = (SELECT id FROM reseller) AND (SELECT id FROM self_service) IS NOT NULL
        AND s.id NOT IN (SELECT seller_id FROM verified)
      RETURNING s.id AS seller_id
    ), marked AS (
      UPDATE sellers SET reseller_access = (id IN (SELECT seller_id FROM granted))
      WHERE id IN (SELECT seller_id FROM granted UNION SELECT seller_id FROM removed)
    ), logged AS (
      INSERT INTO seller_events (seller_id, action, detail)
      SELECT seller_id, 'account.reseller_access_granted', '{"role":"Reseller"}'::jsonb FROM granted
      UNION ALL
      SELECT seller_id, 'account.reseller_access_removed', '{"role":"Seller"}'::jsonb FROM removed
    )
    SELECT (SELECT count(*) FROM granted)::int AS granted, (SELECT count(*) FROM removed)::int AS removed`
  return result
}

function event(tx: Transaction, sellerId: string, actorId: string | null, action: string, detail: Prisma.InputJsonObject = {}) {
  return tx.sellerEvent.create({ data: { seller_id: sellerId, actor_id: actorId, action, detail } })
}

function activeAuthorization(tx: Transaction, sellerId: string, now: Date) {
  return tx.sellerAuthorization.findFirst({ where: { seller_id: sellerId, revoked_at: null, expires_at: { gt: now } } })
}

async function endCoverage(tx: Transaction, subscriptionIds: string[], now: Date, reason: string) {
  if (!subscriptionIds.length) return
  await tx.$executeRaw`
    UPDATE seller_coverage SET ended_at = LEAST(valid_until, ${now}), end_reason = ${reason}
    WHERE subscription_id = ANY(${subscriptionIds}::uuid[]) AND ended_at IS NULL`
}

function cancelNotices(tx: Transaction, subscriptionIds: string[], now: Date) {
  return tx.sellerNotice.updateMany({
    where: { subscription_id: { in: subscriptionIds }, delivered_at: null, cancelled_at: null }, data: { cancelled_at: now },
  })
}

// Verified subscriptions lose their entitlement immediately and wait for a reviewer.
async function requireReview(tx: Transaction, sellerId: string, actorId: string, now: Date, reason: string) {
  const verified = await tx.sellerSubscription.findMany({ where: { seller_id: sellerId, status: "VERIFIED" }, select: { id: true } })
  const ids = verified.map(subscription => subscription.id)
  if (!ids.length) return
  await tx.sellerSubscription.updateMany({ where: { id: { in: ids } }, data: { status: "REVIEW_REQUIRED", status_reason: reason, updated_at: now } })
  await endCoverage(tx, ids, now, reason)
  await cancelNotices(tx, ids, now)
  await event(tx, sellerId, actorId, "subscription.review_required", { subscriptionIds: ids, reason })
  await syncResellerAccess(tx, sellerId)
}

async function scheduleNotices(tx: Transaction, sellerId: string, subscriptionId: string, now: Date,
  periodEnd: Date, nextReview: Date, authorization: SellerAuthorization) {
  await cancelNotices(tx, [subscriptionId], now)
  const ends = isoDate(periodEnd)
  const notices: Prisma.SellerNoticeCreateManyInput[] = renewalNoticeDays
    .map(days => new Date(periodEnd.getTime() - days * day))
    .filter(due => due > now)
    .map(due => ({
      seller_id: sellerId, subscription_id: subscriptionId, kind: "RENEWAL", audience: "seller", due_at: due,
      message: `Your verified coverage ends on ${ends}. Renew your SAN with the FTC if needed, then choose coverage and pay for the next period here.`,
    }))
  notices.push({
    seller_id: sellerId, subscription_id: subscriptionId, kind: "EXPIRED", audience: "seller", due_at: periodEnd,
    message: `Verified coverage ended on ${ends}. Choose coverage and pay for a new period to restore access.`,
  })
  if (nextReview < periodEnd) {
    notices.push({
      seller_id: sellerId, subscription_id: subscriptionId, kind: "REVIEW_DUE", audience: "reviewer", due_at: nextReview,
      message: "Periodic verification review is due. Re-check the SAN and subscribed area codes with the FTC.",
    })
  }
  if (authorization.expires_at < periodEnd) {
    notices.push({
      seller_id: sellerId, subscription_id: subscriptionId, kind: "AUTHORIZATION_EXPIRING", audience: "seller",
      due_at: new Date(Math.max(now.getTime(), authorization.expires_at.getTime() - 30 * day)),
      message: `Your seller authorization expires on ${isoDate(authorization.expires_at)}, before your coverage ends. Sign a new authorization to keep coverage.`,
    })
  }
  await tx.sellerNotice.createMany({ data: notices })
}

const authorizationSelect = {
  id: true, signer_name: true, signer_title: true, signer_email: true, signed_at: true, permitted_scope: true,
  expires_at: true, revocation_channel: true, revocation_contact: true, revoked_at: true, revocation_reason: true,
} satisfies Prisma.SellerAuthorizationSelect

const subscriptionSelect = {
  id: true, status: true, requested_area_codes: true, status_reason: true, period_start: true, period_end: true,
  verified_at: true, next_review_at: true, created_at: true, coverage_scope: true, selected_states: true,
  billing_cycle: true, amount_cents: true, currency: true, paid_at: true, paid_through: true,
  payments: { select: paymentSelect, orderBy: { created_at: "desc" }, take: 10 },
} satisfies Prisma.SellerSubscriptionSelect

const coverageSelect = {
  subscription_id: true, area_code: true, valid_from: true, valid_until: true, ended_at: true, end_reason: true,
} satisfies Prisma.SellerCoverageSelect

const noticeSelect = {
  id: true, subscription_id: true, kind: true, message: true, due_at: true, delivered_at: true,
} satisfies Prisma.SellerNoticeSelect

const profileSelect = {
  id: true, legal_name: true, organization_id: true, san_last4: true, representative_name: true,
  representative_title: true, representative_email: true, representative_phone: true, created_at: true, updated_at: true,
} satisfies Prisma.SellerSelect

export function sellersRepository(db: Database) {
  return {
    async overview(ownerId: string) {
      const now = new Date()
      return db.seller.findUnique({
        where: { owner_id: ownerId },
        select: {
          ...profileSelect,
          authorizations: { where: { revoked_at: null, expires_at: { gt: now } }, select: authorizationSelect, take: 1 },
          subscriptions: {
            select: { ...subscriptionSelect, coverage: { select: coverageSelect, orderBy: { area_code: "asc" } } },
            orderBy: { created_at: "desc" }, take: 20,
          },
          notices: {
            where: { audience: "seller", delivered_at: { not: null }, cancelled_at: null },
            select: noticeSelect, orderBy: { due_at: "desc" }, take: 20,
          },
        },
      })
    },

    // Subscriptions are created separately, when the seller chooses coverage and pays.
    async create(ownerId: string, sellerId: string, identity: SellerIdentity, san: StoredSan) {
      return serializable(db, async tx => {
        const owner = await tx.user.findFirst({ where: { id: ownerId, active: true }, select: { seller: { select: { id: true } } } })
        if (!owner || owner.seller) return undefined
        await tx.seller.create({
          data: {
            id: sellerId, owner_id: ownerId, ...sellerFields(identity),
            san_ciphertext: san.ciphertext, san_key_id: san.keyId, san_last4: san.last4,
          },
        })
        await event(tx, sellerId, ownerId, "seller.created")
        return { id: sellerId }
      })
    },

    findSan(ownerId: string) {
      return db.seller.findUnique({ where: { owner_id: ownerId }, select: { id: true, san_key_id: true, san_ciphertext: true } })
    },

    async update(ownerId: string, identity: SellerIdentity, san: StoredSan | null) {
      return serializable(db, async tx => {
        const seller = await tx.seller.findUnique({ where: { owner_id: ownerId } })
        if (!seller) return undefined
        const fields = sellerFields(identity)
        const changed = (Object.keys(fields) as (keyof typeof fields)[]).filter(field => seller[field] !== fields[field])
        if (san) changed.push("san" as never)
        const identityChanged = changed.some(field => ["legal_name", "organization_id", "san"].includes(field))
        if (!changed.length) return { id: seller.id, identityChanged }
        const now = new Date()
        await tx.seller.update({
          where: { id: seller.id },
          data: {
            ...fields, updated_at: now,
            ...san && { san_ciphertext: san.ciphertext, san_key_id: san.keyId, san_last4: san.last4 },
          },
        })
        await event(tx, seller.id, ownerId, "seller.updated", { fields: changed })
        if (identityChanged) await requireReview(tx, seller.id, ownerId, now, "Seller identity changed. Re-verification is required.")
        return { id: seller.id, identityChanged }
      })
    },

    async sign(ownerId: string, data: AuthorizationData) {
      return serializable(db, async tx => {
        const seller = await tx.seller.findUnique({ where: { owner_id: ownerId }, select: { id: true, legal_name: true } })
        if (!seller) return undefined
        const now = new Date()
        const superseded = await tx.sellerAuthorization.updateManyAndReturn({
          where: { seller_id: seller.id, revoked_at: null },
          data: { revoked_at: now, revoked_by: ownerId, revocation_reason: "Superseded by a new authorization." },
          select: { id: true },
        })
        const authorization = await tx.sellerAuthorization.create({
          data: {
            seller_id: seller.id, signed_by: ownerId, signed_at: now,
            signer_name: data.signerName, signer_title: data.signerTitle, signer_email: data.signerEmail,
            permitted_scope: data.permittedScope, expires_at: data.expiresAt,
            revocation_channel: data.revocationChannel, revocation_contact: data.revocationContact,
            evidence: { ...data.evidence, legalName: seller.legal_name, signedAt: now.toISOString() },
          },
          select: { id: true },
        })
        // Verified coverage is capped at the previous authorization's expiry, so a reviewer must re-verify to extend it.
        await tx.sellerSubscription.updateMany({ where: { seller_id: seller.id, status: "VERIFIED" }, data: { next_review_at: now } })
        await event(tx, seller.id, ownerId, "authorization.signed", {
          authorizationId: authorization.id, supersedes: superseded.map(item => item.id),
          permittedScope: data.permittedScope, expiresAt: data.expiresAt.toISOString(),
        })
        return authorization
      })
    },

    async revoke(ownerId: string, authorizationId: string, reason: string) {
      return serializable(db, async tx => {
        const authorization = await tx.sellerAuthorization.findFirst({
          where: { id: authorizationId, revoked_at: null, seller: { owner_id: ownerId } }, select: { id: true, seller_id: true },
        })
        if (!authorization) return undefined
        const now = new Date()
        await tx.sellerAuthorization.update({
          where: { id: authorization.id }, data: { revoked_at: now, revoked_by: ownerId, revocation_reason: reason },
        })
        await event(tx, authorization.seller_id, ownerId, "authorization.revoked", { authorizationId, reason, channel: "in_app" })
        await requireReview(tx, authorization.seller_id, ownerId, now, "The seller revoked its authorization.")
        return { id: authorization.id }
      })
    },

    async reviewQueue() {
      const now = new Date()
      return db.seller.findMany({
        select: {
          id: true, legal_name: true, organization_id: true, san_last4: true, updated_at: true,
          owner: { select: { email: true } },
          authorizations: { where: { revoked_at: null, expires_at: { gt: now } }, select: { id: true }, take: 1 },
          subscriptions: { select: { id: true, status: true, next_review_at: true, created_at: true }, orderBy: { created_at: "desc" } },
        },
        orderBy: { updated_at: "desc" }, take: 500,
      })
    },

    reviewDetail(sellerId: string) {
      return db.seller.findUnique({
        where: { id: sellerId },
        select: {
          ...profileSelect,
          owner: { select: { name: true, email: true } },
          authorizations: { select: { ...authorizationSelect, evidence: true }, orderBy: { signed_at: "desc" } },
          subscriptions: {
            select: {
              ...subscriptionSelect,
              coverage: { select: coverageSelect, orderBy: { area_code: "asc" } },
              verifications: {
                select: {
                  id: true, subscription_id: true, outcome: true, reviewer_name: true, reviewer_email: true,
                  san_period_start: true, san_period_end: true, confirmed_area_codes: true, evidence: true, reasons: true, created_at: true,
                },
                orderBy: { created_at: "desc" },
              },
            },
            orderBy: { created_at: "desc" },
          },
          notices: { where: { cancelled_at: null }, select: { ...noticeSelect, audience: true }, orderBy: { due_at: "desc" }, take: 50 },
          events: {
            select: { id: true, action: true, detail: true, created_at: true, actor: { select: { email: true } } },
            orderBy: { created_at: "desc" }, take: 100,
          },
        },
      })
    },

    async revealSan(sellerId: string, reviewerId: string) {
      return serializable(db, async tx => {
        const seller = await tx.seller.findUnique({ where: { id: sellerId }, select: { id: true, san_key_id: true, san_ciphertext: true } })
        if (!seller) return undefined
        await event(tx, seller.id, reviewerId, "san.revealed")
        return seller
      })
    },

    async verify(subscriptionId: string, reviewerId: string,
      decide: (context: { authorization: SellerAuthorization | null; now: Date; paidAt: Date | null; paidThrough: Date | null }) => Decision) {
      return serializable(db, async tx => {
        const now = new Date()
        const reviewer = await tx.user.findFirst({ where: { id: reviewerId, active: true }, select: { id: true, name: true, email: true } })
        const subscription = await tx.sellerSubscription.findUnique({
          where: { id: subscriptionId },
          select: {
            id: true, status: true, paid_at: true, paid_through: true, billing_cycle: true,
            seller: { select: { id: true, owner_id: true } },
          },
        })
        if (!reviewer || !subscription) return "missing" as const
        if (subscription.seller.owner_id === reviewer.id) return "self" as const
        if (!["PENDING", "REVIEW_REQUIRED", "VERIFIED"].includes(subscription.status)) return "closed" as const

        const sellerId = subscription.seller.id
        const authorization = await activeAuthorization(tx, sellerId, now)
        // The paid billing period starts when coverage is first verified, so review time is not charged to the seller.
        const paidThrough = subscription.paid_through
          ?? (subscription.paid_at && subscription.billing_cycle ? addCycle(now, subscription.billing_cycle) : null)
        const decision = decide({ authorization, now, paidAt: subscription.paid_at, paidThrough })
        const verification = await tx.sellerVerification.create({
          data: {
            subscription_id: subscription.id, authorization_id: authorization?.id ?? null,
            reviewer_id: reviewer.id, reviewer_name: reviewer.name, reviewer_email: reviewer.email,
            outcome: decision.outcome, san_period_start: decision.periodStart, san_period_end: decision.periodEnd,
            confirmed_area_codes: decision.areaCodes, evidence: decision.evidence, reasons: decision.reasons,
          },
          select: { id: true },
        })

        if (decision.outcome === "VERIFIED" && authorization && decision.periodStart && decision.periodEnd && paidThrough) {
          const { periodStart, periodEnd } = decision
          const entitlementEnd = earliest(periodEnd, paidThrough)
          const validUntil = earliest(entitlementEnd, authorization.expires_at)
          const nextReview = earliest(new Date(now.getTime() + reviewIntervalDays * day), entitlementEnd)
          await tx.sellerSubscription.update({
            where: { id: subscription.id },
            data: {
              status: "VERIFIED", status_reason: null, period_start: periodStart, period_end: periodEnd, paid_through: paidThrough,
              verified_at: now, verified_by: reviewer.id, next_review_at: nextReview, updated_at: now,
            },
          })
          await tx.sellerCoverage.updateMany({
            where: { subscription_id: subscription.id, area_code: { notIn: decision.areaCodes }, ended_at: null },
            data: { ended_at: now, end_reason: "Not confirmed at the latest verification." },
          })
          await tx.$executeRaw`
            INSERT INTO seller_coverage (subscription_id, area_code, verification_id, valid_from, valid_until)
            SELECT ${subscription.id}::uuid, code, ${verification.id}::uuid, ${periodStart}, ${validUntil}
            FROM unnest(${decision.areaCodes}::text[]) AS code
            ON CONFLICT (subscription_id, area_code) DO UPDATE SET
              verification_id = EXCLUDED.verification_id, valid_from = EXCLUDED.valid_from,
              valid_until = EXCLUDED.valid_until, ended_at = NULL, end_reason = NULL`
          await scheduleNotices(tx, sellerId, subscription.id, now, entitlementEnd, nextReview, authorization)
        } else {
          await tx.sellerSubscription.update({
            where: { id: subscription.id },
            data: { status: decision.outcome, status_reason: decision.reasons.join(" "), updated_at: now },
          })
          if (subscription.status === "VERIFIED") await endCoverage(tx, [subscription.id], now, "Verification was not confirmed at review.")
          await cancelNotices(tx, [subscription.id], now)
        }
        await event(tx, sellerId, reviewer.id, "verification.recorded", {
          subscriptionId: subscription.id, verificationId: verification.id, outcome: decision.outcome, reasons: decision.reasons,
        })
        await syncResellerAccess(tx, sellerId)
        return { outcome: decision.outcome, reasons: decision.reasons }
      })
    },

    // Idempotent maintenance that is safe to run from several API instances at once.
    async runMaintenance(now = new Date()) {
      // Deliver due notices first, so a notice that was due before a lapse is not cancelled with the entitlement.
      const [delivered] = await db.$queryRaw<{ count: number }[]>`
        WITH delivered AS (
          UPDATE seller_notices SET delivered_at = ${now}
          WHERE delivered_at IS NULL AND cancelled_at IS NULL AND due_at <= ${now}
          RETURNING id, seller_id, kind
        ), logged AS (
          INSERT INTO seller_events (seller_id, action, detail)
          SELECT seller_id, 'notice.delivered', jsonb_build_object('noticeId', id, 'kind', kind) FROM delivered
        )
        SELECT count(*)::int AS count FROM delivered`
      const [expired] = await db.$queryRaw<{ count: number }[]>`
        WITH expired AS (
          UPDATE seller_subscriptions SET status = 'EXPIRED', updated_at = ${now},
            status_reason = CASE WHEN paid_through <= period_end THEN 'The paid billing period ended.' ELSE 'The verified SAN period ended.' END
          WHERE status = 'VERIFIED' AND (period_end <= ${now} OR paid_through <= ${now})
          RETURNING id, seller_id
        ), logged AS (
          INSERT INTO seller_events (seller_id, action, detail)
          SELECT seller_id, 'subscription.expired', jsonb_build_object('subscriptionId', id) FROM expired
        )
        SELECT count(*)::int AS count FROM expired`
      const [lapsed] = await db.$queryRaw<{ count: number }[]>`
        WITH lapsed AS (
          UPDATE seller_subscriptions s SET status = 'REVIEW_REQUIRED', status_reason = 'The seller authorization expired.', updated_at = ${now}
          WHERE s.status = 'VERIFIED' AND NOT EXISTS (
            SELECT 1 FROM seller_authorizations a WHERE a.seller_id = s.seller_id AND a.revoked_at IS NULL AND a.expires_at > ${now}
          )
          RETURNING id, seller_id
        ), cancelled AS (
          UPDATE seller_notices n SET cancelled_at = ${now} FROM lapsed
          WHERE n.subscription_id = lapsed.id AND n.delivered_at IS NULL AND n.cancelled_at IS NULL
        ), logged AS (
          INSERT INTO seller_events (seller_id, action, detail)
          SELECT seller_id, 'subscription.review_required', jsonb_build_object('subscriptionId', id, 'reason', 'The seller authorization expired.') FROM lapsed
        )
        SELECT count(*)::int AS count FROM lapsed`
      const ended = await db.$executeRaw`
        UPDATE seller_coverage SET ended_at = valid_until, end_reason = 'The entitlement reached its verified end date.'
        WHERE ended_at IS NULL AND valid_until <= ${now}`
      const access = await syncResellerAccess(db)
      return {
        expired: expired.count, lapsed: lapsed.count, coverageEnded: ended, noticesDelivered: delivered.count,
        resellerAccessGranted: access.granted, resellerAccessRemoved: access.removed,
      }
    },
  }
}

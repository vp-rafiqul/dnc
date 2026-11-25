import { serializable } from "../../db/prisma.ts"
import type { Database, Transaction } from "../../db/prisma.ts"
import type { Prisma } from "../../generated/prisma/client.ts"

export const openStatuses = ["AWAITING_PAYMENT", "PENDING", "REVIEW_REQUIRED"]

export interface SubscriptionOrder {
  scope: string
  states: string[]
  areaCodes: string[]
  cycle: string
  amountCents: number
  currency: string
  quote: Prisma.InputJsonObject
}

export type PaymentConfirmation =
  | { kind: "stripe"; sessionId: string; paymentIntent: string | null; amountCents: number | null; currency: string | null }
  | { kind: "bank"; actorId: string; bankReference: string | null; note: string | null }

export const paymentSelect = {
  id: true, subscription_id: true, method: true, status: true, amount_cents: true, currency: true, reference: true,
  checkout_url: true, created_at: true, confirmed_at: true,
} satisfies Prisma.SellerPaymentSelect

function event(tx: Transaction, sellerId: string, actorId: string | null, action: string, detail: Prisma.InputJsonObject = {}) {
  return tx.sellerEvent.create({ data: { seller_id: sellerId, actor_id: actorId, action, detail } })
}

function createPayment(tx: Transaction, subscription: { id: string; seller_id: string; amount_cents: number | null; currency: string | null },
  method: string, reference: string) {
  return tx.sellerPayment.create({
    data: {
      subscription_id: subscription.id, seller_id: subscription.seller_id, method, reference,
      amount_cents: subscription.amount_cents ?? 0, currency: subscription.currency ?? "usd",
    },
    select: paymentSelect,
  })
}

export function billingRepository(db: Database) {
  return {
    settings() {
      return db.billingSettings.findUniqueOrThrow({ where: { id: 1 } })
    },

    catalog(activeOnly: boolean) {
      return db.coverageState.findMany({
        where: activeOnly ? { active: true } : {},
        select: {
          code: true, name: true, active: true,
          area_codes: {
            where: activeOnly ? { active: true } : {},
            select: { area_code: true, state_code: true, active: true, monthly_price_cents: true, yearly_price_cents: true },
            orderBy: { area_code: "asc" },
          },
        },
        orderBy: { name: "asc" },
      })
    },

    async updateSettings(actorId: string, data: { monthly: number; yearly: number; bankInstructions: string }) {
      return db.billingSettings.update({
        where: { id: 1 },
        data: {
          monthly_price_cents: data.monthly, yearly_price_cents: data.yearly, bank_instructions: data.bankInstructions,
          updated_at: new Date(), updated_by: actorId,
        },
      })
    },

    createState(code: string, name: string) {
      return db.coverageState.create({ data: { code, name } })
    },

    updateState(code: string, data: { name?: string; active?: boolean }) {
      return db.coverageState.update({ where: { code }, data }).catch(() => undefined)
    },

    async createAreaCode(data: { areaCode: string; state: string; monthly: number | null; yearly: number | null }) {
      if (!await db.coverageState.findUnique({ where: { code: data.state }, select: { code: true } })) return undefined
      return db.coverageAreaCode.create({
        data: { area_code: data.areaCode, state_code: data.state, monthly_price_cents: data.monthly, yearly_price_cents: data.yearly },
      })
    },

    async updateAreaCode(areaCode: string, data: { state?: string; active?: boolean; monthly?: number | null; yearly?: number | null }) {
      if (data.state && !await db.coverageState.findUnique({ where: { code: data.state }, select: { code: true } })) return undefined
      return db.coverageAreaCode.update({
        where: { area_code: areaCode },
        data: {
          ...data.state && { state_code: data.state },
          ...data.active !== undefined && { active: data.active },
          ...data.monthly !== undefined && { monthly_price_cents: data.monthly },
          ...data.yearly !== undefined && { yearly_price_cents: data.yearly },
        },
      }).catch(() => undefined)
    },

    // Creates the subscription request and its first payment together; the price was quoted from the live catalog.
    async purchase(ownerId: string, order: SubscriptionOrder, method: string, reference: string) {
      return serializable(db, async tx => {
        const seller = await tx.seller.findUnique({ where: { owner_id: ownerId }, select: { id: true } })
        if (!seller) return "missing" as const
        if (await tx.sellerSubscription.findFirst({ where: { seller_id: seller.id, status: { in: openStatuses } }, select: { id: true } })) {
          return "open" as const
        }
        const subscription = await tx.sellerSubscription.create({
          data: {
            seller_id: seller.id, status: "AWAITING_PAYMENT", coverage_scope: order.scope, selected_states: order.states,
            requested_area_codes: order.areaCodes, billing_cycle: order.cycle, amount_cents: order.amountCents,
            currency: order.currency, quote: order.quote,
          },
          select: { id: true, seller_id: true, amount_cents: true, currency: true },
        })
        const payment = await createPayment(tx, subscription, method, reference)
        await event(tx, seller.id, ownerId, "subscription.requested", {
          subscriptionId: subscription.id, scope: order.scope, states: order.states, areaCodeCount: order.areaCodes.length,
          cycle: order.cycle, amountCents: order.amountCents, paymentId: payment.id, method,
        })
        return { subscriptionId: subscription.id, payment }
      })
    },

    async retryPayment(ownerId: string, subscriptionId: string, method: string, reference: string) {
      return serializable(db, async tx => {
        const subscription = await tx.sellerSubscription.findFirst({
          where: { id: subscriptionId, status: "AWAITING_PAYMENT", seller: { owner_id: ownerId } },
          select: { id: true, seller_id: true, amount_cents: true, currency: true },
        })
        if (!subscription) return undefined
        const now = new Date()
        await tx.sellerPayment.updateMany({
          where: { subscription_id: subscription.id, status: "PENDING" }, data: { status: "CANCELLED", updated_at: now },
        })
        const payment = await createPayment(tx, subscription, method, reference)
        await event(tx, subscription.seller_id, ownerId, "payment.started", { subscriptionId, paymentId: payment.id, method })
        return payment
      })
    },

    async cancelSubscription(ownerId: string, subscriptionId: string) {
      return serializable(db, async tx => {
        const subscription = await tx.sellerSubscription.findFirst({
          where: { id: subscriptionId, status: "AWAITING_PAYMENT", seller: { owner_id: ownerId } }, select: { id: true, seller_id: true },
        })
        if (!subscription) return undefined
        const now = new Date()
        await tx.sellerPayment.updateMany({ where: { subscription_id: subscription.id, status: "PENDING" }, data: { status: "CANCELLED", updated_at: now } })
        await tx.sellerSubscription.update({
          where: { id: subscription.id }, data: { status: "CANCELLED", status_reason: "Cancelled by the seller before payment.", updated_at: now },
        })
        await event(tx, subscription.seller_id, ownerId, "subscription.cancelled", { subscriptionId })
        return { id: subscription.id }
      })
    },

    attachCheckout(paymentId: string, sessionId: string, url: string | null) {
      return db.sellerPayment.update({
        where: { id: paymentId }, data: { stripe_session_id: sessionId, checkout_url: url, updated_at: new Date() }, select: paymentSelect,
      })
    },

    findSellerPayment(ownerId: string, paymentId: string) {
      return db.sellerPayment.findFirst({
        where: { id: paymentId, seller: { owner_id: ownerId } },
        select: { ...paymentSelect, stripe_session_id: true },
      })
    },

    findPaymentBySession(sessionId: string) {
      return db.sellerPayment.findUnique({ where: { stripe_session_id: sessionId }, select: { id: true } })
    },

    async markFailed(paymentId: string, status: "FAILED" | "CANCELLED", detail: Prisma.InputJsonObject, actorId: string | null = null) {
      return serializable(db, async tx => {
        const payment = await tx.sellerPayment.findUnique({ where: { id: paymentId }, select: { id: true, status: true, seller_id: true, subscription_id: true, details: true } })
        if (!payment || payment.status !== "PENDING") return undefined
        const details = { ...payment.details as Prisma.JsonObject, ...detail }
        await tx.sellerPayment.update({ where: { id: payment.id }, data: { status, details, updated_at: new Date(), confirmed_by: actorId } })
        await event(tx, payment.seller_id, actorId, status === "FAILED" ? "payment.failed" : "payment.cancelled", {
          paymentId: payment.id, subscriptionId: payment.subscription_id, ...detail,
        })
        return { id: payment.id }
      })
    },

    // Idempotent: a payment that is already PAID is reported as such. A paid subscription moves to the verification queue.
    async markPaid(paymentId: string, confirmation: PaymentConfirmation) {
      return serializable(db, async tx => {
        const payment = await tx.sellerPayment.findUnique({
          where: { id: paymentId },
          select: {
            id: true, status: true, method: true, amount_cents: true, currency: true, stripe_session_id: true, seller_id: true, details: true,
            subscription: { select: { id: true, status: true } },
          },
        })
        if (!payment) return "missing" as const
        if (payment.status === "PAID") return "already" as const
        if (confirmation.kind === "stripe") {
          if (payment.method !== "card" || payment.stripe_session_id !== confirmation.sessionId
            || confirmation.amountCents !== payment.amount_cents || confirmation.currency?.toLowerCase() !== payment.currency) {
            await event(tx, payment.seller_id, null, "payment.mismatch", { paymentId, sessionId: confirmation.sessionId })
            return "mismatch" as const
          }
        } else if (payment.method !== "bank_transfer" || payment.status !== "PENDING") {
          return "invalid" as const
        }

        const now = new Date()
        const details: Prisma.InputJsonObject = {
          ...payment.details as Prisma.JsonObject,
          ...confirmation.kind === "stripe"
            ? { stripeSessionId: confirmation.sessionId, stripePaymentIntent: confirmation.paymentIntent }
            : { bankReference: confirmation.bankReference, note: confirmation.note },
        }
        await tx.sellerPayment.update({
          where: { id: payment.id },
          data: {
            status: "PAID", confirmed_at: now, details, updated_at: now,
            confirmed_by: confirmation.kind === "bank" ? confirmation.actorId : null,
            stripe_payment_intent: confirmation.kind === "stripe" ? confirmation.paymentIntent : undefined,
          },
        })
        const actorId = confirmation.kind === "bank" ? confirmation.actorId : null
        await event(tx, payment.seller_id, actorId, "payment.received", {
          paymentId: payment.id, method: payment.method, amountCents: payment.amount_cents,
        })

        const subscription = payment.subscription
        const reopen = subscription.status === "CANCELLED" && !await tx.sellerSubscription.findFirst({
          where: { seller_id: payment.seller_id, status: { in: openStatuses }, id: { not: subscription.id } }, select: { id: true },
        })
        if (subscription.status === "AWAITING_PAYMENT" || reopen) {
          await tx.sellerSubscription.update({
            where: { id: subscription.id }, data: { status: "PENDING", status_reason: null, paid_at: now, updated_at: now },
          })
          await tx.sellerPayment.updateMany({
            where: { subscription_id: subscription.id, status: "PENDING", id: { not: payment.id } }, data: { status: "CANCELLED", updated_at: now },
          })
          await event(tx, payment.seller_id, actorId, "subscription.paid", { subscriptionId: subscription.id, paymentId: payment.id })
        } else {
          await event(tx, payment.seller_id, actorId, "payment.needs_refund", {
            paymentId: payment.id, subscriptionId: subscription.id, reason: `The subscription was ${subscription.status} when the payment arrived.`,
          })
        }
        return "paid" as const
      })
    },

    payments(status?: string) {
      return db.sellerPayment.findMany({
        where: status ? { status } : {},
        select: {
          ...paymentSelect, details: true,
          seller: { select: { id: true, legal_name: true, owner: { select: { email: true } } } },
          subscription: { select: { billing_cycle: true, coverage_scope: true, requested_area_codes: true, selected_states: true } },
          confirmer: { select: { email: true } },
        },
        orderBy: { created_at: "desc" }, take: 200,
      })
    },
  }
}

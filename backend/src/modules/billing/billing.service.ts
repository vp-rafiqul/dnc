import { randomBytes } from "node:crypto"
import { z } from "zod"
import { HttpError } from "../../errors.ts"
import type {
  AdminCatalog, AdminPaymentRecord, BillingCycle, BillingSettingsRecord, CoverageScope, PaymentRecord, Principal,
  SellerCatalog, SellerPurchaseResult,
} from "../../../../shared/contracts.ts"
import type { billingRepository } from "./billing.repository.ts"
import type { CheckoutSession, StripeClient, StripeEvent } from "./stripe.ts"

type Repository = ReturnType<typeof billingRepository>
interface PaymentRow {
  id: string; subscription_id: string; method: string; status: string; amount_cents: number; currency: string
  reference: string; checkout_url: string | null; created_at: Date; confirmed_at: Date | null
}

const cents = z.number().int().min(0).max(100_000_000)
const stateCode = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Use a 2-letter state code.")
const areaCode = z.string().trim().regex(/^[2-9][0-8][0-9]$/, "Enter a 3-digit US area code.")
  .refine(code => !code.endsWith("11"), "N11 service codes are not area codes.")
const method = z.enum(["card", "bank_transfer"])
const purchaseInput = z.object({
  scope: z.enum(["national", "states", "area_codes"]),
  states: z.array(stateCode).max(60).optional().transform(values => [...new Set(values ?? [])].sort()),
  areaCodes: z.array(areaCode).max(1000).optional().transform(values => [...new Set(values ?? [])].sort()),
  cycle: z.enum(["monthly", "yearly"]),
  method,
})
const settingsInput = z.object({
  monthlyPriceCents: cents, yearlyPriceCents: cents, bankInstructions: z.string().trim().max(4000),
})
const stateInput = z.object({ code: stateCode, name: z.string().trim().min(2).max(80) })
const stateUpdate = z.object({ name: z.string().trim().min(2).max(80).optional(), active: z.boolean().optional() })
const areaCodeInput = z.object({
  areaCode, state: stateCode, monthlyPriceCents: cents.nullable().optional(), yearlyPriceCents: cents.nullable().optional(),
})
const areaCodeUpdate = z.object({
  state: stateCode.optional(), active: z.boolean().optional(),
  monthlyPriceCents: cents.nullable().optional(), yearlyPriceCents: cents.nullable().optional(),
})
const confirmInput = z.object({ bankReference: z.string().trim().max(120).optional(), note: z.string().trim().max(1000).optional() })
const rejectInput = z.object({ note: z.string().trim().min(1, "Explain why the payment is rejected.").max(1000) })
const paymentStatus = z.enum(["PENDING", "PAID", "FAILED", "CANCELLED"]).optional()

const iso = (value: Date) => value.toISOString()
const reference = () => `DNC-${randomBytes(5).toString("hex").toUpperCase()}`

export function toPayment(row: PaymentRow): PaymentRecord {
  return {
    id: row.id, subscription_id: row.subscription_id, method: row.method as PaymentRecord["method"],
    status: row.status as PaymentRecord["status"], amount_cents: row.amount_cents, currency: row.currency,
    reference: row.reference, checkout_url: row.status === "PENDING" ? row.checkout_url : null,
    created_at: iso(row.created_at), confirmed_at: row.confirmed_at ? iso(row.confirmed_at) : null,
  }
}

const money = (amountCents: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(amountCents / 100)

export function billingService(repository: Repository, stripe: StripeClient | null, frontendOrigin: string, webhooksEnabled: boolean,
  publishableKey: string | null = null) {
  async function quote(scope: CoverageScope, states: string[], codes: string[], cycle: BillingCycle) {
    const [settings, catalog] = await Promise.all([repository.settings(), repository.catalog(true)])
    const fallback = cycle === "monthly" ? settings.monthly_price_cents : settings.yearly_price_cents
    const available = new Map(catalog.flatMap(state => state.area_codes.map(code => [code.area_code, code] as const)))
    let selected: string[]
    if (scope === "national") selected = [...available.keys()]
    else if (scope === "states") {
      if (!states.length) throw new HttpError(400, "Select at least one state.")
      const byState = new Map(catalog.map(state => [state.code, state]))
      const unknown = states.filter(code => !byState.get(code)?.area_codes.length)
      if (unknown.length) throw new HttpError(400, `These states have no area codes available: ${unknown.join(", ")}.`)
      selected = states.flatMap(code => byState.get(code)!.area_codes.map(item => item.area_code))
    } else {
      if (!codes.length) throw new HttpError(400, "Select at least one area code.")
      const unknown = codes.filter(code => !available.has(code))
      if (unknown.length) throw new HttpError(400, `These area codes are not available: ${unknown.join(", ")}.`)
      selected = codes
    }
    if (!selected.length) throw new HttpError(400, "No area codes are available yet. Contact support.")
    selected = [...new Set(selected)].sort()
    const lines = selected.map(code => {
      const item = available.get(code)!
      const price = (cycle === "monthly" ? item.monthly_price_cents : item.yearly_price_cents) ?? fallback
      return { areaCode: code, state: item.state_code, cents: price }
    })
    const amountCents = lines.reduce((sum, line) => sum + line.cents, 0)
    return {
      scope, states: scope === "states" ? states : [], areaCodes: selected, cycle, amountCents, currency: settings.currency,
      quote: { cycle, defaultCents: fallback, lines, amountCents, quotedAt: new Date().toISOString() },
      bankInstructions: settings.bank_instructions,
    }
  }

  async function startCheckout(user: Principal, payment: PaymentRow, description: string) {
    if (!stripe) throw new HttpError(503, "Card payments are not configured.")
    try {
      const session = await stripe.createCheckoutSession({
        paymentId: payment.id, reference: payment.reference, amountCents: payment.amount_cents, currency: payment.currency,
        description, email: user.email,
        successUrl: `${frontendOrigin}/seller?payment=${payment.id}`,
        cancelUrl: `${frontendOrigin}/seller?payment=${payment.id}&checkout=cancelled`,
      })
      const row = await repository.attachCheckout(payment.id, session.id, session.url ?? null)
      return { row, clientSecret: session.client_secret ?? null }
    } catch (error) {
      await repository.markFailed(payment.id, "FAILED", { reason: "Checkout could not be started." })
      throw error
    }
  }

  async function settleSession(session: CheckoutSession) {
    const payment = await repository.findPaymentBySession(session.id)
    const paymentId = payment?.id ?? session.metadata?.payment_id
    if (!paymentId) return
    if (session.payment_status === "paid") {
      await repository.markPaid(paymentId, {
        kind: "stripe", sessionId: session.id, paymentIntent: session.payment_intent, amountCents: session.amount_total, currency: session.currency,
      })
    } else if (session.status === "expired") {
      await repository.markFailed(paymentId, "FAILED", { reason: "The checkout session expired.", stripeSessionId: session.id })
    }
  }

  function embedded(clientSecret: string | null) {
    return { client_secret: clientSecret, publishable_key: clientSecret ? publishableKey : null }
  }

  function describe(cycle: BillingCycle, codes: number) {
    return `DNC registry coverage, ${codes} area code${codes === 1 ? "" : "s"}, ${cycle}`
  }

  return {
    async sellerCatalog(): Promise<SellerCatalog> {
      const [settings, catalog] = await Promise.all([repository.settings(), repository.catalog(true)])
      return {
        states: catalog.filter(state => state.area_codes.length).map(state => ({
          code: state.code, name: state.name,
          area_codes: state.area_codes.map(code => ({
            area_code: code.area_code,
            monthly_cents: code.monthly_price_cents ?? settings.monthly_price_cents,
            yearly_cents: code.yearly_price_cents ?? settings.yearly_price_cents,
          })),
        })),
        currency: settings.currency, card_enabled: Boolean(stripe), bank_instructions: settings.bank_instructions,
      }
    },

    async purchase(user: Principal, body: unknown): Promise<SellerPurchaseResult> {
      const input = purchaseInput.parse(body)
      if (input.method === "card" && !stripe) throw new HttpError(400, "Card payments are not available. Choose bank transfer.")
      const order = await quote(input.scope, input.states, input.areaCodes, input.cycle)
      const result = await repository.purchase(user.id, order, input.method, reference())
      if (result === "missing") throw new HttpError(404, "Create a seller profile first.")
      if (result === "open") throw new HttpError(409, "You already have a subscription request in progress. Pay for it or cancel it first.")
      const checkout = input.method === "card"
        ? await startCheckout(user, result.payment, describe(input.cycle, order.areaCodes.length))
        : { row: result.payment, clientSecret: null }
      return {
        subscription_id: result.subscriptionId, amount_cents: order.amountCents, currency: order.currency,
        payment: toPayment(checkout.row), checkout_url: checkout.row.checkout_url, ...embedded(checkout.clientSecret),
        bank_instructions: input.method === "bank_transfer" ? order.bankInstructions : null,
      }
    },

    async retryPayment(user: Principal, subscriptionId: string, body: unknown): Promise<SellerPurchaseResult> {
      const { method: chosen } = z.object({ method }).parse(body)
      if (chosen === "card" && !stripe) throw new HttpError(400, "Card payments are not available. Choose bank transfer.")
      const payment = await repository.retryPayment(user.id, subscriptionId, chosen, reference())
      if (!payment) throw new HttpError(404, "No unpaid subscription request was found.")
      const checkout = chosen === "card" ? await startCheckout(user, payment, "DNC registry coverage") : { row: payment, clientSecret: null }
      const settled = checkout.row
      const settings = await repository.settings()
      return {
        subscription_id: subscriptionId, amount_cents: settled.amount_cents, currency: settled.currency, payment: toPayment(settled),
        checkout_url: settled.checkout_url, ...embedded(checkout.clientSecret),
        bank_instructions: chosen === "bank_transfer" ? settings.bank_instructions : null,
      }
    },

    async cancel(user: Principal, subscriptionId: string) {
      if (!await repository.cancelSubscription(user.id, subscriptionId)) throw new HttpError(404, "No unpaid subscription request was found.")
    },

    // Called when the seller returns from Stripe Checkout. Works without webhook forwarding in local development.
    async refreshPayment(user: Principal, paymentId: string): Promise<PaymentRecord> {
      const payment = await repository.findSellerPayment(user.id, paymentId)
      if (!payment) throw new HttpError(404, "Payment not found.")
      if (payment.method === "card" && payment.stripe_session_id && payment.status !== "PAID" && stripe) {
        await settleSession(await stripe.retrieveCheckoutSession(payment.stripe_session_id))
        return toPayment((await repository.findSellerPayment(user.id, paymentId))!)
      }
      return toPayment(payment)
    },

    async webhook(payload: Buffer, signature: string | undefined) {
      if (!stripe || !webhooksEnabled) throw new HttpError(503, "Stripe webhooks are not configured.")
      const event: StripeEvent = stripe.verifyWebhook(payload, signature)
      if (["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "checkout.session.expired"].includes(event.type)) {
        const session = event.data.object
        if (event.type === "checkout.session.async_payment_failed") {
          const payment = await repository.findPaymentBySession(session.id)
          if (payment) await repository.markFailed(payment.id, "FAILED", { reason: "The bank declined the payment.", stripeSessionId: session.id })
        } else {
          await settleSession(session)
        }
      }
    },

    async adminCatalog(): Promise<AdminCatalog> {
      const [settings, states] = await Promise.all([repository.settings(), repository.catalog(false)])
      return { settings: toSettings(settings), states, card_enabled: Boolean(stripe) }
    },

    async updateSettings(actor: Principal, body: unknown): Promise<BillingSettingsRecord> {
      const input = settingsInput.parse(body)
      return toSettings(await repository.updateSettings(actor.id, {
        monthly: input.monthlyPriceCents, yearly: input.yearlyPriceCents, bankInstructions: input.bankInstructions,
      }))
    },

    async createState(body: unknown) {
      const { code, name } = stateInput.parse(body)
      return repository.createState(code, name)
    },

    async updateState(code: string, body: unknown) {
      const updated = await repository.updateState(stateCode.parse(code), stateUpdate.parse(body))
      if (!updated) throw new HttpError(404, "State not found.")
      return updated
    },

    async createAreaCode(body: unknown) {
      const input = areaCodeInput.parse(body)
      const created = await repository.createAreaCode({
        areaCode: input.areaCode, state: input.state, monthly: input.monthlyPriceCents ?? null, yearly: input.yearlyPriceCents ?? null,
      })
      if (!created) throw new HttpError(400, "Add the state before adding its area codes.")
      return created
    },

    async updateAreaCode(code: string, body: unknown) {
      const input = areaCodeUpdate.parse(body)
      const updated = await repository.updateAreaCode(areaCode.parse(code), {
        state: input.state, active: input.active, monthly: input.monthlyPriceCents, yearly: input.yearlyPriceCents,
      })
      if (!updated) throw new HttpError(404, "Area code or state not found.")
      return updated
    },

    async payments(status?: unknown): Promise<AdminPaymentRecord[]> {
      const rows = await repository.payments(paymentStatus.parse(status || undefined))
      return rows.map(row => ({
        ...toPayment(row), seller_id: row.seller.id, legal_name: row.seller.legal_name, owner_email: row.seller.owner.email,
        billing_cycle: row.subscription.billing_cycle as BillingCycle | null,
        coverage_scope: row.subscription.coverage_scope as CoverageScope | null,
        selected_states: row.subscription.selected_states, area_code_count: row.subscription.requested_area_codes.length,
        confirmed_by: row.confirmer?.email ?? null,
        details: row.details && typeof row.details === "object" && !Array.isArray(row.details) ? row.details as Record<string, unknown> : {},
      }))
    },

    async confirmBankTransfer(actor: Principal, paymentId: string, body: unknown) {
      const { bankReference, note } = confirmInput.parse(body ?? {})
      const result = await repository.markPaid(paymentId, { kind: "bank", actorId: actor.id, bankReference: bankReference ?? null, note: note ?? null })
      if (result === "missing") throw new HttpError(404, "Payment not found.")
      if (result === "invalid") throw new HttpError(409, "Only pending bank transfers can be confirmed here.")
      return { status: "PAID" as const }
    },

    async rejectPayment(actor: Principal, paymentId: string, body: unknown) {
      const { note } = rejectInput.parse(body)
      if (!await repository.markFailed(paymentId, "FAILED", { reason: note }, actor.id)) throw new HttpError(409, "Only pending payments can be rejected.")
      return { status: "FAILED" as const }
    },

    money,
  }
}

function toSettings(row: { monthly_price_cents: number; yearly_price_cents: number; currency: string; bank_instructions: string; updated_at: Date }): BillingSettingsRecord {
  return {
    monthly_price_cents: row.monthly_price_cents, yearly_price_cents: row.yearly_price_cents, currency: row.currency,
    bank_instructions: row.bank_instructions, updated_at: iso(row.updated_at),
  }
}

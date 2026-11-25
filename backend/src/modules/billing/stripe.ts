import { createHmac, timingSafeEqual } from "node:crypto"
import type { StripeConfig } from "../../config.ts"
import { HttpError } from "../../errors.ts"

export interface CheckoutSession {
  id: string
  url: string | null
  client_secret?: string | null
  status: string | null
  payment_status: "paid" | "unpaid" | "no_payment_required"
  amount_total: number | null
  currency: string | null
  payment_intent: string | null
  metadata: Record<string, string> | null
}

export interface StripeEvent {
  id: string
  type: string
  data: { object: CheckoutSession }
}

const toleranceSeconds = 300

function form(values: Record<string, string | number>) {
  return new URLSearchParams(Object.entries(values).map(([key, value]) => [key, String(value)])).toString()
}

// A minimal Stripe Checkout client using the REST API, so the project needs no Stripe SDK dependency.
export function stripeClient(config: StripeConfig) {
  async function request<T>(method: "GET" | "POST", path: string, body?: Record<string, string | number>, idempotencyKey?: string): Promise<T> {
    const response = await fetch(`${config.apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.secretKey}`,
        ...body && { "Content-Type": "application/x-www-form-urlencoded" },
        ...idempotencyKey && { "Idempotency-Key": idempotencyKey },
      },
      body: body && form(body),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => { throw new HttpError(502, "The card payment service is unavailable. Try again shortly.") })
    const data = await response.json().catch(() => null) as T & { error?: { message?: string } } | null
    if (!response.ok || !data) {
      const failure = (data as { error?: { type?: string; code?: string; param?: string; message?: string } } | null)?.error
      console.error("Stripe request failed", { status: response.status, type: failure?.type, code: failure?.code, param: failure?.param, message: failure?.message })
      throw new HttpError(502, "The card payment service rejected the request. Try again or choose bank transfer.")
    }
    return data
  }

  return {
    createCheckoutSession(input: {
      paymentId: string; reference: string; amountCents: number; currency: string; description: string
      email: string; successUrl: string; cancelUrl: string
    }) {
      // Embedded mode keeps the seller in the app; completion is reported to Stripe.js (onComplete), so no redirect URLs.
      const presentation: Record<string, string> = config.publishableKey
        ? { ui_mode: "embedded_page", redirect_on_completion: "never" }
        : { success_url: input.successUrl, cancel_url: input.cancelUrl }
      return request<CheckoutSession>("POST", "/v1/checkout/sessions", {
        mode: "payment",
        ...presentation,
        client_reference_id: input.paymentId,
        customer_email: input.email,
        "line_items[0][quantity]": 1,
        "line_items[0][price_data][currency]": input.currency,
        "line_items[0][price_data][unit_amount]": input.amountCents,
        "line_items[0][price_data][product_data][name]": input.description,
        "metadata[payment_id]": input.paymentId,
        "metadata[reference]": input.reference,
        "payment_intent_data[metadata][payment_id]": input.paymentId,
        "allowed_payment_method_types[0]": "card",
        "payment_method_options[card][request_three_d_secure]": config.threeDSecure,
      }, `checkout-${input.paymentId}`)
    },
    retrieveCheckoutSession(id: string) {
      if (!/^cs_[A-Za-z0-9_]+$/.test(id)) throw new HttpError(400, "Invalid checkout session.")
      return request<CheckoutSession>("GET", `/v1/checkout/sessions/${id}`)
    },
    // Verifies the Stripe-Signature header (HMAC-SHA256 over "timestamp.payload") before trusting a webhook.
    verifyWebhook(payload: Buffer, header: string | undefined, now = Date.now()): StripeEvent {
      if (!config.webhookSecret) throw new HttpError(503, "Stripe webhooks are not configured.")
      const parts = (header ?? "").split(",").map(part => part.split("=") as [string, string])
      const timestamp = Number(parts.find(([key]) => key === "t")?.[1])
      const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value)
      if (!Number.isInteger(timestamp) || !signatures.length) throw new HttpError(400, "Invalid Stripe signature.")
      if (Math.abs(now / 1000 - timestamp) > toleranceSeconds) throw new HttpError(400, "Expired Stripe signature.")
      const expected = createHmac("sha256", config.webhookSecret).update(`${timestamp}.`).update(payload).digest()
      const valid = signatures.some(signature => {
        const actual = Buffer.from(signature, "hex")
        return actual.length === expected.length && timingSafeEqual(actual, expected)
      })
      if (!valid) throw new HttpError(400, "Invalid Stripe signature.")
      const event = JSON.parse(payload.toString("utf8")) as StripeEvent
      if (typeof event?.type !== "string" || !event.data?.object) throw new HttpError(400, "Invalid Stripe event.")
      return event
    },
  }
}

export type StripeClient = ReturnType<typeof stripeClient>

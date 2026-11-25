"use client"

import { useEffect, useRef, useState } from "react"
import { loadStripe } from "@stripe/stripe-js"
import { api, errorMessage } from "../lib/api"
import { ErrorText } from "./shared"
import type { PaymentRecord } from "../../shared/contracts"

/** Polls the API, which reads the Checkout Session from Stripe, until the payment settles (about 30 seconds at most). */
export async function waitForPayment(paymentId: string) {
  for (let attempt = 0; attempt < 15; attempt++) {
    const payment = await api<PaymentRecord>(`/seller/billing/payments/${paymentId}/refresh`, { method: "POST" })
    if (payment.status !== "PENDING") return payment
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
  return null
}

// Stripe allows one Embedded Checkout at a time, so setups run one after another (React dev mode mounts twice).
let queue: Promise<void> = Promise.resolve()

// Stripe Embedded Checkout: the card form (including any 3D Secure challenge) runs inside this page.
export function EmbeddedCard({ clientSecret, publishableKey, paymentId, onPaid, onClose }: {
  clientSecret: string
  publishableKey: string
  paymentId: string
  onPaid: () => void
  onClose: () => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<"loading" | "ready" | "confirming" | "failed">("loading")
  const [error, setError] = useState("")
  // Parents pass new callbacks on every render; keep the latest in a ref so the Stripe form mounts only once.
  const paidRef = useRef(onPaid)
  useEffect(() => { paidRef.current = onPaid }, [onPaid])

  useEffect(() => {
    let active = true
    let checkout: { mount: (element: HTMLElement) => void; destroy: () => void } | null = null
    queue = queue.then(async () => {
      if (!active) return
      try {
        const stripe = await loadStripe(publishableKey)
        if (!stripe) throw new Error("The card form could not be loaded. Check your connection and try again.")
        const instance = await stripe.createEmbeddedCheckoutPage({
          clientSecret,
          onComplete: () => {
            if (!active) return
            setState("confirming")
            waitForPayment(paymentId)
              .then(payment => {
                if (!active) return
                if (payment?.status === "PAID") paidRef.current()
                else {
                  setState("failed")
                  setError(payment ? "The card payment did not complete. Try again or pay by bank transfer." : "Stripe has not confirmed the payment yet. Use “Check payment status” in a moment.")
                }
              })
              .catch(failure => { if (active) { setState("failed"); setError(errorMessage(failure)) } })
          },
        })
        if (!active) { instance.destroy(); return }
        checkout = instance
        if (container.current) instance.mount(container.current)
        setState("ready")
      } catch (failure) {
        if (active) { setState("failed"); setError(errorMessage(failure)) }
      }
    })
    return () => {
      active = false
      checkout?.destroy()
    }
  }, [clientSecret, publishableKey, paymentId])

  return (
    <div className="stack">
      {state === "loading" && <p role="status">Loading secure card form…</p>}
      {state === "confirming" && <p className="notice" role="status">Confirming your payment with Stripe…</p>}
      <div ref={container} className="embedded-checkout" hidden={state === "confirming"} />
      <ErrorText error={error} />
      {state !== "confirming" && <div className="button-row">
        <button className="button" type="button" onClick={onClose}>Pay later</button>
      </div>}
    </div>
  )
}

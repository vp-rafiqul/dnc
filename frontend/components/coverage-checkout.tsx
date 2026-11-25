"use client"

import { useCallback, useMemo, useState } from "react"
import { Building, CreditCard, Landmark, Search } from "lucide-react"
import { api, errorMessage } from "../lib/api"
import { useResource } from "./resource"
import { EmbeddedCard } from "./embedded-card"
import { ErrorText, formatMoney } from "./shared"
import type {
  BillingCycle, CoverageScope, PaymentMethod, SellerCatalog, SellerPurchaseInput, SellerPurchaseResult, SellerSubscriptionRecord,
} from "../../shared/contracts"

const scopes: { id: CoverageScope; label: string; hint: string }[] = [
  { id: "national", label: "All of America", hint: "Every available area code" },
  { id: "states", label: "Whole states", hint: "All area codes in the states you pick" },
  { id: "area_codes", label: "Specific area codes", hint: "Only the codes you pick" },
]

export function CoverageCheckout({ onDone }: { onDone: (result: SellerPurchaseResult) => void }) {
  const { data: catalog, error: loadError, pending } = useResource<SellerCatalog>("/seller/billing/catalog")
  const [scope, setScope] = useState<CoverageScope>("states")
  const [cycle, setCycle] = useState<BillingCycle>("monthly")
  const [method, setMethod] = useState<PaymentMethod | null>(null)
  const [states, setStates] = useState<string[]>([])
  const [codes, setCodes] = useState<string[]>([])
  const [filter, setFilter] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [embedded, setEmbedded] = useState<SellerPurchaseResult | null>(null)
  const paid = useCallback(() => { if (embedded) onDone(embedded) }, [embedded, onDone])

  const allCodes = useMemo(() => catalog?.states.flatMap(state => state.area_codes.map(code => ({ ...code, state: state.code }))) ?? [], [catalog])
  const selected = scope === "national" ? allCodes
    : scope === "states" ? allCodes.filter(code => states.includes(code.state))
    : allCodes.filter(code => codes.includes(code.area_code))
  const total = selected.reduce((sum, code) => sum + (cycle === "monthly" ? code.monthly_cents : code.yearly_cents), 0)
  const chosenMethod = method ?? (catalog?.card_enabled ? "card" : "bank_transfer")
  const visibleCodes = allCodes.filter(code => !filter || code.area_code.startsWith(filter.trim()) || code.state === filter.trim().toUpperCase())

  const toggle = (list: string[], set: (value: string[]) => void, value: string) =>
    set(list.includes(value) ? list.filter(item => item !== value) : [...list, value])

  async function checkout() {
    setBusy(true)
    setError("")
    try {
      const body: SellerPurchaseInput = { scope, cycle, method: chosenMethod, ...scope === "states" && { states }, ...scope === "area_codes" && { areaCodes: codes } }
      const result = await api<SellerPurchaseResult>("/seller/billing/subscriptions", { method: "POST", body })
      if (result.client_secret && result.publishable_key) {
        setEmbedded(result)
        return
      }
      if (result.checkout_url) {
        window.location.assign(result.checkout_url)
        return
      }
      onDone(result)
    } catch (error) { setError(errorMessage(error)) }
    finally { setBusy(false) }
  }

  if (embedded?.client_secret && embedded.publishable_key) {
    return (
      <div className="stack">
        <div className="total"><span>Pay by card</span><strong>{formatMoney(embedded.amount_cents, embedded.currency)}</strong></div>
        <EmbeddedCard clientSecret={embedded.client_secret} publishableKey={embedded.publishable_key} paymentId={embedded.payment.id}
          onPaid={paid} onClose={() => onDone(embedded)} />
      </div>
    )
  }
  if (!catalog) return pending ? <p role="status">Loading coverage options…</p> : <ErrorText error={loadError} />
  if (!allCodes.length) return <p className="notice">No area codes are available yet. Please check back soon.</p>

  return (
    <div className="stack">
      <fieldset className="stack">
        <legend>1. Coverage</legend>
        <div className="choice-row" role="radiogroup">
          {scopes.map(item => <label className="choice" key={item.id}>
            <input type="radio" name="scope" checked={scope === item.id} onChange={() => setScope(item.id)} />
            <span>{item.label}<small className="form-note" style={{ display: "block", fontWeight: 400 }}>{item.hint}</small></span>
          </label>)}
        </div>
        {scope === "national" && <p className="form-note">Includes all {allCodes.length} area codes currently available in {catalog.states.length} states.</p>}
        {scope === "states" && <div className="pick-grid" aria-label="States">
          {catalog.states.map(state => <label className="checkbox" key={state.code}>
            <input type="checkbox" checked={states.includes(state.code)} onChange={() => toggle(states, setStates, state.code)} />
            {state.name} <small>({state.area_codes.length})</small>
          </label>)}
        </div>}
        {scope === "area_codes" && <>
          <label className="lookup-row" style={{ maxWidth: 320 }}><Search size={16} /><input value={filter} onChange={event => setFilter(event.target.value)} placeholder="Filter by code or state, e.g. 21 or NY" aria-label="Filter area codes" /></label>
          <div className="pick-grid" aria-label="Area codes">
            {visibleCodes.map(code => <label className="checkbox mono" key={code.area_code}>
              <input type="checkbox" checked={codes.includes(code.area_code)} onChange={() => toggle(codes, setCodes, code.area_code)} />
              {code.area_code} <small>{code.state}</small>
            </label>)}
          </div>
        </>}
      </fieldset>

      <fieldset className="stack">
        <legend>2. Billing</legend>
        <div className="choice-row" role="radiogroup">
          {(["monthly", "yearly"] as const).map(id => <label className="choice" key={id}>
            <input type="radio" name="cycle" checked={cycle === id} onChange={() => setCycle(id)} /> {id === "monthly" ? "Monthly" : "Yearly"}
          </label>)}
        </div>
      </fieldset>

      <fieldset className="stack">
        <legend>3. Payment</legend>
        <div className="choice-row" role="radiogroup">
          <label className="choice" title={catalog.card_enabled ? undefined : "Card payments are not available yet"}>
            <input type="radio" name="method" disabled={!catalog.card_enabled} checked={chosenMethod === "card"} onChange={() => setMethod("card")} />
            <CreditCard size={16} /> Credit card {!catalog.card_enabled && <small>(unavailable)</small>}
          </label>
          <label className="choice">
            <input type="radio" name="method" checked={chosenMethod === "bank_transfer"} onChange={() => setMethod("bank_transfer")} />
            <Landmark size={16} /> Bank transfer
          </label>
        </div>
        <p className="form-note">{chosenMethod === "card"
          ? "Enter your card securely on this page. Your bank may ask you to confirm the payment (3D Secure)."
          : "You will get bank details and a payment reference. Coverage moves forward once we receive the transfer."}</p>
      </fieldset>

      <div className="total">
        <span>{selected.length} area code{selected.length === 1 ? "" : "s"} · {cycle === "monthly" ? "per month" : "per year"}</span>
        <strong>{formatMoney(total, catalog.currency)}</strong>
      </div>
      <p className="form-note">After payment, a reviewer verifies your SAN and area codes with the FTC. Your {cycle === "monthly" ? "month" : "year"} of coverage starts when verification is complete.</p>
      <ErrorText error={error} />
      <div className="button-row">
        <button className="button primary" disabled={busy || !selected.length} onClick={checkout}>
          {chosenMethod === "card" ? <CreditCard size={16} /> : <Building size={16} />} {busy ? "Starting payment…" : chosenMethod === "card" ? "Continue to card payment" : "Get bank transfer details"}
        </button>
      </div>
    </div>
  )
}

export function PaymentDue({ subscription, bankInstructions, cardEnabled, onChanged }: {
  subscription: SellerSubscriptionRecord
  bankInstructions: string
  cardEnabled: boolean
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [embedded, setEmbedded] = useState<SellerPurchaseResult | null>(null)
  const payment = subscription.payments.find(item => item.status === "PENDING")
  const close = useCallback(() => { setEmbedded(null); onChanged() }, [onChanged])

  async function run(work: () => Promise<void>) {
    setBusy(true)
    setError("")
    try { await work() } catch (error) { setError(errorMessage(error)) } finally { setBusy(false) }
  }

  const pay = (method: PaymentMethod) => run(async () => {
    const result = await api<SellerPurchaseResult>(`/seller/billing/subscriptions/${subscription.id}/payments`, { method: "POST", body: { method } })
    if (result.client_secret && result.publishable_key) setEmbedded(result)
    else if (result.checkout_url) window.location.assign(result.checkout_url)
    else onChanged()
  })

  if (embedded?.client_secret && embedded.publishable_key) {
    return (
      <div className="notice stack">
        <strong>Pay {formatMoney(embedded.amount_cents, embedded.currency)} by card</strong>
        <EmbeddedCard clientSecret={embedded.client_secret} publishableKey={embedded.publishable_key} paymentId={embedded.payment.id}
          onPaid={close} onClose={close} />
      </div>
    )
  }

  return (
    <div className="notice stack">
      <strong>Payment due: {formatMoney(subscription.amount_cents, subscription.currency ?? "usd")} {subscription.billing_cycle === "yearly" ? "per year" : "per month"}</strong>
      <small>{subscription.coverage_scope === "national" ? "All of America" : subscription.coverage_scope === "states" ? `States: ${subscription.selected_states.join(", ")}` : "Selected area codes"} · {subscription.requested_area_codes.length} area codes</small>
      {payment?.method === "bank_transfer" && <>
        <p>Transfer the amount using this reference so we can match your payment:</p>
        <p className="mono" style={{ fontSize: "1.1rem" }}><strong>{payment.reference}</strong></p>
        {bankInstructions ? <div className="consent bank-box">{bankInstructions}</div> : <p className="form-note">Bank details will be sent by our team.</p>}
        <p className="form-note">We will confirm the transfer and send your subscription to verification.</p>
      </>}
      {payment?.method === "card" && <p>Your card checkout has not completed yet.</p>}
      {!payment && <p>The last payment attempt did not complete. Choose how to pay.</p>}
      <ErrorText error={error} />
      <div className="button-row">
        {payment?.method === "card" && payment.checkout_url && <a className="button primary" href={payment.checkout_url}><CreditCard size={16} /> Resume card payment</a>}
        {payment?.method === "card" && <button className="button" disabled={busy} onClick={() => run(async () => {
          await api(`/seller/billing/payments/${payment.id}/refresh`, { method: "POST" })
          onChanged()
        })}>Check payment status</button>}
        {cardEnabled && (payment?.method !== "card" || !payment.checkout_url) && <button className="button primary" disabled={busy} onClick={() => pay("card")}><CreditCard size={16} /> Pay by card</button>}
        {payment?.method !== "bank_transfer" && <button className="button" disabled={busy} onClick={() => pay("bank_transfer")}><Landmark size={16} /> Pay by bank transfer</button>}
        <button className="button danger" disabled={busy} onClick={() => run(async () => {
          await api(`/seller/billing/subscriptions/${subscription.id}/cancel`, { method: "POST" })
          onChanged()
        })}>Cancel request</button>
      </div>
    </div>
  )
}

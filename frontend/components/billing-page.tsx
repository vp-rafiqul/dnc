"use client"

import { useState } from "react"
import type { FormEvent } from "react"
import { CircleDollarSign, Landmark, MapPinned, Plus, Settings2 } from "lucide-react"
import { api, displayDate, errorMessage } from "../lib/api"
import { useResource } from "./resource"
import { ErrorText, formatMoney, PageHeading, toCents } from "./shared"
import type { AdminCatalog, AdminCatalogAreaCode, AdminPaymentRecord } from "../../shared/contracts"

const dollars = (cents: number | null) => cents === null ? "" : (cents / 100).toFixed(2)

function useAction(after: () => Promise<unknown> | void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function run(work: () => Promise<unknown>) {
    setBusy(true)
    setError("")
    try {
      await work()
      await after()
      return true
    } catch (error) {
      setError(errorMessage(error))
      return false
    } finally { setBusy(false) }
  }
  return { busy, error, run }
}

function Settings({ catalog, reload }: { catalog: AdminCatalog; reload: () => Promise<void> }) {
  const { busy, error, run } = useAction(reload)
  const [saved, setSaved] = useState(false)
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    setSaved(false)
    void run(() => api("/admin/billing/settings", {
      method: "PUT",
      body: {
        monthlyPriceCents: toCents(fields.get("monthly")), yearlyPriceCents: toCents(fields.get("yearly")),
        bankInstructions: String(fields.get("bankInstructions") ?? ""),
      },
    })).then(ok => setSaved(ok))
  }
  return (
    <section className="card">
      <div className="card-heading"><span className="card-icon"><Settings2 size={18} /></span><div><h2>Default prices and bank details</h2><p>The price per area code unless an area code has its own price. Changes apply to new purchases.</p></div></div>
      <form className="stack" onSubmit={submit}>
        <div className="fields">
          <label>Monthly price per area code ({catalog.settings.currency.toUpperCase()})<input name="monthly" type="number" min={0} step="0.01" required defaultValue={dollars(catalog.settings.monthly_price_cents)} /></label>
          <label>Yearly price per area code ({catalog.settings.currency.toUpperCase()})<input name="yearly" type="number" min={0} step="0.01" required defaultValue={dollars(catalog.settings.yearly_price_cents)} /></label>
          <label>Card payments<input readOnly value={catalog.card_enabled ? "Enabled (Stripe)" : "Disabled: set STRIPE_SECRET_KEY"} /></label>
        </div>
        <label>Bank transfer instructions <small>Shown to sellers who pay by bank transfer</small>
          <textarea name="bankInstructions" maxLength={4000} defaultValue={catalog.settings.bank_instructions} placeholder={"Bank name\nAccount name\nAccount number\nRouting number"} />
        </label>
        <ErrorText error={error} />
        <div className="button-row"><button className="button primary" disabled={busy}>Save settings</button>{saved && <span className="tag clear">Saved</span>}</div>
      </form>
    </section>
  )
}

function AreaCodeRow({ code, states, reload }: { code: AdminCatalogAreaCode; states: AdminCatalog["states"]; reload: () => Promise<void> }) {
  const { busy, error, run } = useAction(reload)
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    void run(() => api(`/admin/billing/area-codes/${code.area_code}`, {
      method: "PATCH",
      body: {
        state: fields.get("state"), active: fields.get("active") === "on",
        monthlyPriceCents: toCents(fields.get("monthly")), yearlyPriceCents: toCents(fields.get("yearly")),
      },
    }))
  }
  const formId = `code-${code.area_code}`
  return (
    <tr>
      <td className="mono"><strong>{code.area_code}</strong><form id={formId} onSubmit={submit} /></td>
      <td><select form={formId} name="state" defaultValue={code.state_code} aria-label="State">{states.map(state => <option key={state.code} value={state.code}>{state.code}</option>)}</select></td>
      <td><input form={formId} name="monthly" type="number" min={0} step="0.01" defaultValue={dollars(code.monthly_price_cents)} placeholder="Default" aria-label="Monthly price" style={{ width: 100 }} /></td>
      <td><input form={formId} name="yearly" type="number" min={0} step="0.01" defaultValue={dollars(code.yearly_price_cents)} placeholder="Default" aria-label="Yearly price" style={{ width: 100 }} /></td>
      <td><label className="checkbox"><input form={formId} type="checkbox" name="active" defaultChecked={code.active} /> Available</label></td>
      <td><button form={formId} className="button small" disabled={busy}>Save</button>{error && <ErrorText error={error} />}</td>
    </tr>
  )
}

function Catalog({ catalog, reload }: { catalog: AdminCatalog; reload: () => Promise<void> }) {
  const state = useAction(reload)
  const code = useAction(reload)
  const [filter, setFilter] = useState("")
  const codes = catalog.states.flatMap(item => item.area_codes)
    .filter(item => !filter || item.area_code.startsWith(filter) || item.state_code === filter.toUpperCase())
    .sort((a, b) => a.area_code.localeCompare(b.area_code))

  return (
    <section className="card">
      <div className="card-heading"><span className="card-icon purple"><MapPinned size={18} /></span><div><h2>States and area codes</h2><p>Sellers can only choose available area codes in available states. Leave a price empty to use the default.</p></div></div>
      <form className="inline-form" onSubmit={event => {
        event.preventDefault()
        const form = event.currentTarget
        const fields = new FormData(form)
        void code.run(() => api("/admin/billing/area-codes", {
          method: "POST",
          body: {
            areaCode: String(fields.get("areaCode") ?? "").trim(), state: fields.get("state"),
            monthlyPriceCents: toCents(fields.get("monthly")), yearlyPriceCents: toCents(fields.get("yearly")),
          },
        })).then(ok => ok && form.reset())
      }}>
        <label style={{ maxWidth: 120 }}>Area code<input name="areaCode" className="mono" required pattern="[2-9][0-8][0-9]" maxLength={3} placeholder="917" /></label>
        <label style={{ maxWidth: 220 }}>State<select name="state" required defaultValue="">{[<option key="" value="" disabled>Select</option>, ...catalog.states.map(item => <option key={item.code} value={item.code}>{item.name}</option>)]}</select></label>
        <label style={{ maxWidth: 140 }}>Monthly price<input name="monthly" type="number" min={0} step="0.01" placeholder="Default" /></label>
        <label style={{ maxWidth: 140 }}>Yearly price<input name="yearly" type="number" min={0} step="0.01" placeholder="Default" /></label>
        <button className="button primary" disabled={code.busy}><Plus size={16} /> Add area code</button>
      </form>
      <ErrorText error={code.error} />
      <label className="lookup-row" style={{ maxWidth: 300 }}><input value={filter} onChange={event => setFilter(event.target.value.trim())} placeholder="Filter by code or state" aria-label="Filter area codes" /></label>
      <div className="table-wrap" style={{ maxHeight: 420 }}><table>
        <thead><tr><th>Area code</th><th>State</th><th>Monthly</th><th>Yearly</th><th>Status</th><th></th></tr></thead>
        <tbody>{codes.map(item => <AreaCodeRow key={item.area_code} code={item} states={catalog.states} reload={reload} />)}</tbody>
      </table></div>

      <details style={{ marginTop: 16 }}>
        <summary>States ({catalog.states.length})</summary>
        <form className="inline-form" onSubmit={event => {
          event.preventDefault()
          const form = event.currentTarget
          const fields = new FormData(form)
          void state.run(() => api("/admin/billing/states", { method: "POST", body: { code: fields.get("code"), name: fields.get("name") } }))
            .then(ok => ok && form.reset())
        }}>
          <label style={{ maxWidth: 100 }}>Code<input name="code" required pattern="[A-Za-z]{2}" maxLength={2} placeholder="PR" /></label>
          <label>Name<input name="name" required minLength={2} maxLength={80} placeholder="Puerto Rico" /></label>
          <button className="button" disabled={state.busy}><Plus size={16} /> Add state</button>
        </form>
        <ErrorText error={state.error} />
        <div className="table-wrap"><table>
          <thead><tr><th>State</th><th>Area codes</th><th>Status</th><th></th></tr></thead>
          <tbody>{catalog.states.map(item => <tr key={item.code}>
            <td><strong>{item.code}</strong> {item.name}</td>
            <td>{item.area_codes.filter(code => code.active).length} available / {item.area_codes.length}</td>
            <td><span className={`tag ${item.active ? "clear" : ""}`}>{item.active ? "Available" : "Hidden"}</span></td>
            <td><button className="button small" disabled={state.busy} onClick={() => state.run(() => api(`/admin/billing/states/${item.code}`, { method: "PATCH", body: { active: !item.active } }))}>{item.active ? "Hide" : "Make available"}</button></td>
          </tr>)}</tbody>
        </table></div>
      </details>
    </section>
  )
}

function Payments() {
  const [status, setStatus] = useState("PENDING")
  const { data, error: loadError, pending, reload } = useResource<AdminPaymentRecord[]>(`/admin/billing/payments${status ? `?status=${status}` : ""}`)
  const { busy, error, run } = useAction(reload)
  const [acting, setActing] = useState<{ payment: AdminPaymentRecord; action: "confirm" | "reject" } | null>(null)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!acting) return
    const fields = new FormData(event.currentTarget)
    const body = acting.action === "confirm"
      ? { bankReference: String(fields.get("bankReference") ?? "").trim() || undefined, note: String(fields.get("note") ?? "").trim() || undefined }
      : { note: String(fields.get("note") ?? "") }
    void run(() => api(`/admin/billing/payments/${acting.payment.id}/${acting.action}`, { method: "POST", body })).then(ok => ok && setActing(null))
  }

  return (
    <section className="card">
      <div className="card-heading"><span className="card-icon"><CircleDollarSign size={18} /></span><div><h2>Payments</h2><p>Confirm bank transfers once the money arrives. Paid subscriptions go to Seller verification.</p></div></div>
      <label className="history-pagination" style={{ border: 0, margin: 0, padding: 0, justifyContent: "flex-start" }}>Show
        <select value={status} onChange={event => setStatus(event.target.value)}>
          <option value="PENDING">Pending</option><option value="PAID">Paid</option><option value="FAILED">Failed</option><option value="CANCELLED">Cancelled</option><option value="">All</option>
        </select>
      </label>
      <ErrorText error={loadError || error} />
      {pending && !data && <p role="status">Loading payments…</p>}
      {data?.length === 0 && <div className="empty inset"><Landmark size={22} /><strong>No payments in this view</strong></div>}
      {data && data.length > 0 && <div className="table-wrap"><table>
        <thead><tr><th>Created</th><th>Seller</th><th>Reference</th><th>Method</th><th>Plan</th><th>Amount</th><th>Status</th><th></th></tr></thead>
        <tbody>{data.map(item => <tr key={item.id}>
          <td>{displayDate(item.created_at)}</td>
          <td><strong>{item.legal_name}</strong><br /><small>{item.owner_email}</small></td>
          <td className="mono">{item.reference}</td>
          <td>{item.method === "card" ? "Card" : "Bank transfer"}</td>
          <td>{item.area_code_count} codes · {item.billing_cycle}</td>
          <td>{formatMoney(item.amount_cents, item.currency)}</td>
          <td><span className={`tag ${item.status === "PAID" ? "clear" : item.status === "PENDING" ? "match" : ""}`}>{item.status}</span>{item.confirmed_by && <><br /><small>by {item.confirmed_by}</small></>}</td>
          <td>{item.status === "PENDING" && <div className="button-row">
            {item.method === "bank_transfer" && <button className="button small primary" disabled={busy} onClick={() => setActing({ payment: item, action: "confirm" })}>Confirm received</button>}
            <button className="button small" disabled={busy} onClick={() => setActing({ payment: item, action: "reject" })}>Reject</button>
          </div>}</td>
        </tr>)}</tbody>
      </table></div>}
      {acting && <form className="notice stack" onSubmit={submit}>
        <strong>{acting.action === "confirm" ? "Confirm" : "Reject"} {formatMoney(acting.payment.amount_cents, acting.payment.currency)} from {acting.payment.legal_name} ({acting.payment.reference})</strong>
        {acting.action === "confirm" && <label>Bank transaction reference <small>Optional</small><input name="bankReference" maxLength={120} /></label>}
        <label>{acting.action === "confirm" ? "Note (optional)" : "Reason"}<textarea name="note" maxLength={1000} required={acting.action === "reject"} /></label>
        <div className="button-row">
          <button className={`button ${acting.action === "confirm" ? "primary" : "danger"}`} disabled={busy}>{acting.action === "confirm" ? "Mark as paid" : "Reject payment"}</button>
          <button className="button" type="button" disabled={busy} onClick={() => setActing(null)}>Cancel</button>
        </div>
      </form>}
    </section>
  )
}

export function BillingPage() {
  const { data, error, pending, reload } = useResource<AdminCatalog>("/admin/billing/catalog")
  return (
    <>
      <PageHeading title="Billing" description="Coverage catalog, prices, and seller payments." />
      <div className="stack">
        <Payments />
        {data ? <><Settings catalog={data} reload={reload} /><Catalog catalog={data} reload={reload} /></>
          : pending ? <p role="status">Loading catalog…</p> : <ErrorText error={error} />}
      </div>
    </>
  )
}

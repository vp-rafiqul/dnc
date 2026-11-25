"use client"

import { useState } from "react"
import type { FormEvent } from "react"
import { BadgeCheck, Eye, FileSignature, History, MapPinned, ScrollText, X } from "lucide-react"
import { api, displayDate, errorMessage } from "../lib/api"
import { useResource } from "./resource"
import { displayDay, displayLastDay, ErrorText, formatMoney, isoDay, PageHeading, parseAreaCodes, StatusTag } from "./shared"
import type {
  EvidenceCheck, SellerReviewDetail, SellerReviewSummary, SellerSubscriptionRecord, SellerVerificationInput, SellerVerificationResult,
} from "../../shared/contracts"

const filters = [
  ["", "All sellers"], ["PENDING", "Paid · pending verification"], ["AWAITING_PAYMENT", "Awaiting payment"], ["REVIEW_REQUIRED", "Review required"], ["REVIEW_DUE", "Periodic review due"],
  ["VERIFIED", "Verified"], ["REJECTED", "Rejected"], ["EXPIRED", "Expired"],
] as const
const checks: { name: "identity" | "sanPeriod" | "areaCodes"; label: string }[] = [
  { name: "identity", label: "Seller identity matches the FTC record" },
  { name: "sanPeriod", label: "SAN is active for the stated period" },
  { name: "areaCodes", label: "Subscribed area codes match" },
]
const reviewable = (item: SellerSubscriptionRecord) => ["PENDING", "REVIEW_REQUIRED", "VERIFIED"].includes(item.status)
const text = (fields: FormData, name: string) => String(fields.get(name) ?? "").trim() || undefined

function VerificationForm({ detail, busy, onSubmit }: {
  detail: SellerReviewDetail
  busy: boolean
  onSubmit: (subscriptionId: string, body: SellerVerificationInput) => void
}) {
  const options = detail.subscriptions.filter(reviewable)
  const [subscriptionId, setSubscriptionId] = useState(options[0]?.id ?? "")
  const selected = options.find(item => item.id === subscriptionId)
  if (!selected) return <p className="notice">No subscription is waiting for verification. The seller must request a new one.</p>

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
    const fields = new FormData(event.currentTarget)
    onSubmit(subscriptionId, {
      // Submitting the form is the reviewer's attestation that they checked the seller with the FTC.
      decision: submitter?.value === "reject" ? "reject" : "verify", attested: true,
      ftcReference: text(fields, "ftcReference"), checkedOn: text(fields, "checkedOn"),
      identity: fields.get("identity") as EvidenceCheck, sanPeriod: fields.get("sanPeriod") as EvidenceCheck,
      areaCodes: fields.get("areaCodes") as EvidenceCheck,
      sanPeriodStart: text(fields, "sanPeriodStart"), sanPeriodEnd: text(fields, "sanPeriodEnd"),
      confirmedAreaCodes: parseAreaCodes(fields.get("confirmedAreaCodes")),
      evidenceLocation: text(fields, "evidenceLocation"), notes: text(fields, "notes"),
    })
  }

  const paid = Boolean(selected.paid_at)
  const lastDay = (value: string | null) => value ? new Date(new Date(value).getTime() - 1).toISOString().slice(0, 10) : undefined
  return (
    <div className="stack">
      {options.length > 1 && <label>Subscription
        <select value={subscriptionId} onChange={event => setSubscriptionId(event.target.value)}>
          {options.map(item => <option key={item.id} value={item.id}>{displayDate(item.created_at)} · {item.status}</option>)}
        </select>
      </label>}
      {paid
        ? <p className="notice"><strong>Payment received</strong> · {selected.requested_area_codes.length} area code{selected.requested_area_codes.length === 1 ? "" : "s"}, {selected.billing_cycle}. {selected.status === "VERIFIED"
          ? "This is a periodic review: confirming again extends coverage to the dates below."
          : `Verifying starts the paid ${selected.billing_cycle === "yearly" ? "year" : "month"} and turns on coverage.`}</p>
        : <p className="notice">This subscription has not been paid yet, so it cannot be verified.</p>}
      <form className="stack" key={selected.id} onSubmit={submit}>
        <p className="form-note">Check the seller in the FTC service-provider client using the SAN. Everything starts as confirmed: change a check to <em>Unclear</em> to send it back for review, or <em>Does not match</em> to reject it.</p>
        <fieldset className="stack">
          <legend>FTC record checks</legend>
          <div className="fields">
            {checks.map(check => <label key={check.name}>{check.label}
              <select name={check.name} defaultValue="confirmed">
                <option value="confirmed">Confirmed</option>
                <option value="unclear">Unclear</option>
                <option value="mismatch">Does not match</option>
              </select>
            </label>)}
          </div>
        </fieldset>
        <div className="fields">
          <label>SAN period start<input name="sanPeriodStart" type="date" required defaultValue={selected.period_start?.slice(0, 10) ?? isoDay()} /></label>
          <label>SAN period end <small>Last valid day</small><input name="sanPeriodEnd" type="date" required defaultValue={lastDay(selected.period_end) ?? isoDay(364)} /></label>
          <label>Confirmed area codes<input name="confirmedAreaCodes" className="mono" required defaultValue={selected.requested_area_codes.join(", ")} /></label>
        </div>
        <div className="fields">
          <label>FTC reference <small>Optional</small><input name="ftcReference" maxLength={120} placeholder="Reference from the service-provider client" /></label>
          <label>Checked on<input name="checkedOn" type="date" required max={isoDay()} defaultValue={isoDay()} /></label>
          <label>Evidence location <small>Optional</small><input name="evidenceLocation" maxLength={500} placeholder="Document store path or ticket" /></label>
        </div>
        <label>Notes <small>Required to reject</small><textarea name="notes" maxLength={2000} /></label>
        <div className="button-row">
          <button className="button primary" name="decision" value="verify" disabled={busy || !paid}><BadgeCheck size={16} /> Verify &amp; activate</button>
          <button className="button danger" name="decision" value="reject" disabled={busy}>Reject</button>
        </div>
      </form>
    </div>
  )
}

function SellerDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { data: detail, pending, error: loadError, reload } = useResource<SellerReviewDetail>(`/admin/sellers/${id}`)
  const [san, setSan] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<SellerVerificationResult | null>(null)

  async function reveal() {
    setBusy(true)
    setError("")
    try {
      setSan((await api<{ san: string }>(`/admin/sellers/${id}/san`, { method: "POST" })).san)
      await reload()
    }
    catch (error) { setError(errorMessage(error)) }
    finally { setBusy(false) }
  }

  async function verify(subscriptionId: string, body: SellerVerificationInput) {
    setBusy(true)
    setError("")
    setResult(null)
    try {
      setResult(await api<SellerVerificationResult>(`/admin/sellers/subscriptions/${subscriptionId}/verifications`, { method: "POST", body }))
      await reload()
      onChanged()
    } catch (error) { setError(errorMessage(error)) }
    finally { setBusy(false) }
  }

  if (!detail) return <section className="card">{pending ? <p role="status">Loading seller…</p> : <ErrorText error={loadError} />}</section>
  const { profile } = detail

  return (
    <div className="stack">
      <section className="card">
        <div className="card-heading">
          <span className="card-icon"><BadgeCheck size={18} /></span>
          <div style={{ flex: 1 }}><h2>{profile.legal_name}</h2><p>Account {detail.owner.name} · {detail.owner.email}</p></div>
          <button className="icon-button" aria-label="Close seller" title="Close" onClick={onClose}><X size={17} /></button>
        </div>
        <dl className="details">
          <div><dt>Organization ID</dt><dd>{profile.organization_id}</dd></div>
          <div><dt>SAN</dt><dd className="mono">{san || profile.masked_san}{" "}
            {!san && <button className="button small" disabled={busy} onClick={reveal}><Eye size={14} /> Reveal</button>}</dd></div>
          <div><dt>Representative</dt><dd>{profile.representative.name}, {profile.representative.title}</dd></div>
          <div><dt>Contact</dt><dd>{profile.representative.email} · {profile.representative.phone}</dd></div>
        </dl>
        {san && <p className="form-note" style={{ marginTop: 10 }}>SAN reveals are recorded in the seller's audit log.</p>}
      </section>

      <section className="card">
        <div className="card-heading"><span className="card-icon purple"><ScrollText size={18} /></span><div><h2>Verify with the FTC</h2><p>Your name and email are recorded with each decision.</p></div></div>
        <VerificationForm detail={detail} busy={busy} onSubmit={verify} />
        <ErrorText error={error} />
        {result && <div className="notice stack" role="status">
          <strong>Recorded: <StatusTag status={result.outcome} /></strong>
          {result.reasons.length > 0 && <ul>{result.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
        </div>}
      </section>

      <section className="card">
        <div className="card-heading"><span className="card-icon"><MapPinned size={18} /></span><div><h2>Subscriptions and coverage</h2></div></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Requested</th><th>Status</th><th>Plan / payment</th><th>Requested codes</th><th>Verified period</th><th>Next review</th></tr></thead>
          <tbody>{detail.subscriptions.map(item => <tr key={item.id}>
            <td>{displayDate(item.created_at)}</td>
            <td><StatusTag status={item.status} />{item.status_reason && <small className="form-note"><br />{item.status_reason}</small>}</td>
            <td>{item.billing_cycle ? `${formatMoney(item.amount_cents, item.currency ?? "usd")} ${item.billing_cycle}` : "—"}<br /><small>{item.paid_at ? `Paid ${displayDate(item.paid_at)}` : "Not paid"}{item.paid_through && ` · through ${displayDay(item.paid_through)}`}</small></td>
            <td className="mono wrap">{item.requested_area_codes.join(", ")}</td>
            <td>{item.period_start ? `${displayDay(item.period_start)} – ${displayLastDay(item.period_end)}` : "—"}</td>
            <td>{item.status === "VERIFIED" ? displayDay(item.next_review_at) : "—"}</td>
          </tr>)}</tbody>
        </table></div>
        {detail.coverage.length > 0 && <div className="table-wrap"><table>
          <thead><tr><th>Area code</th><th>Status</th><th>Valid</th><th>Ended</th></tr></thead>
          <tbody>{detail.coverage.map(item => <tr key={`${item.subscription_id}-${item.area_code}`}>
            <td className="mono">{item.area_code}</td>
            <td><span className={`tag ${item.active ? "clear" : ""}`}>{item.active ? "Active" : item.ended_at ? "Ended" : "Scheduled"}</span></td>
            <td>{displayDay(item.valid_from)} – {displayLastDay(item.valid_until)}</td>
            <td className="wrap">{item.ended_at ? `${displayDate(item.ended_at)}: ${item.end_reason}` : "—"}</td>
          </tr>)}</tbody>
        </table></div>}
      </section>

      <section className="card">
        <div className="card-heading"><span className="card-icon"><FileSignature size={18} /></span><div><h2>Seller authorizations</h2></div></div>
        {detail.authorizations.length === 0 && <p className="form-note">The seller has not signed an authorization.</p>}
        <div className="stack">{detail.authorizations.map(item => <div key={item.id} className="notice stack">
          <strong>{item.signer_name}, {item.signer_title} <span className={`tag ${item.active ? "clear" : ""}`}>{item.active ? "Active" : item.revoked_at ? "Revoked" : "Expired"}</span></strong>
          <small>Signed {displayDate(item.signed_at)} · expires {displayLastDay(item.expires_at)} · revocation via {item.revocation_channel === "email" ? item.revocation_contact : "workspace"}
            {item.revoked_at && ` · revoked ${displayDate(item.revoked_at)}: ${item.revocation_reason}`}</small>
          <small>Scope: {item.permitted_scope.join(", ")}</small>
          <details><summary>Signature evidence</summary><pre>{JSON.stringify(item.evidence, null, 2)}</pre></details>
        </div>)}</div>
      </section>

      <section className="card">
        <div className="card-heading"><span className="card-icon"><History size={18} /></span><div><h2>Verification history and audit log</h2></div></div>
        {detail.verifications.map(item => <details key={item.id} style={{ marginBottom: 8 }}>
          <summary>{displayDate(item.created_at)} · {item.outcome} · {item.reviewer_name} ({item.reviewer_email})</summary>
          {item.reasons.length > 0 && <ul>{item.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
          <pre>{JSON.stringify({ ...item.evidence, sanPeriodStart: item.san_period_start, sanPeriodEnd: item.san_period_end, confirmedAreaCodes: item.confirmed_area_codes }, null, 2)}</pre>
        </details>)}
        <details><summary>Notices ({detail.notices.length})</summary>
          <ul className="notice-list" style={{ marginTop: 8 }}>{detail.notices.map(item => <li key={item.id}>{item.kind}: {item.message}<small>Due {displayDate(item.due_at)} · {item.delivered_at ? "delivered" : "scheduled"}</small></li>)}</ul>
        </details>
        <details><summary>Audit events ({detail.events.length})</summary>
          <div className="table-wrap"><table>
            <thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>Detail</th></tr></thead>
            <tbody>{detail.events.map(item => <tr key={item.id}><td>{displayDate(item.created_at)}</td><td>{item.action}</td><td>{item.actor ?? "System"}</td><td className="mono wrap">{JSON.stringify(item.detail)}</td></tr>)}</tbody>
          </table></div>
        </details>
      </section>
    </div>
  )
}

export function SellerReviewPage() {
  const [filter, setFilter] = useState("")
  const [selected, setSelected] = useState<string | null>(null)
  const { data, pending, error, reload } = useResource<SellerReviewSummary[]>(`/admin/sellers${filter ? `?status=${filter}` : ""}`)

  return (
    <>
      <PageHeading title="Seller verification" description="Verify seller SANs and subscribed area codes through the FTC service-provider client." />
      <div className="stack">
        <section className="card">
          <div className="history-toolbar" style={{ borderTop: 0, marginTop: 0, paddingTop: 0 }}>
            <label className="history-pagination" style={{ border: 0, margin: 0, padding: 0 }}>Show
              <select value={filter} onChange={event => setFilter(event.target.value)}>
                {filters.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>
          <ErrorText error={error} />
          {pending && !data && <p role="status">Loading sellers…</p>}
          {data?.length === 0 && <div className="empty inset"><BadgeCheck size={23} /><strong>No sellers in this view</strong></div>}
          {data && data.length > 0 && <div className="table-wrap"><table>
            <thead><tr><th>Seller</th><th>Organization ID</th><th>SAN</th><th>Account</th><th>Status</th><th>Authorization</th><th>Actions</th></tr></thead>
            <tbody>{data.map(item => <tr key={item.id} aria-selected={selected === item.id}>
              <td><strong>{item.legal_name}</strong></td>
              <td>{item.organization_id}</td>
              <td className="mono">{item.masked_san}</td>
              <td>{item.owner_email}</td>
              <td><StatusTag status={item.status} />{item.review_due && <> <span className="tag match">Review due</span></>}</td>
              <td><span className={`tag ${item.authorization_active ? "clear" : ""}`}>{item.authorization_active ? "Active" : "None"}</span></td>
              <td><button className="button small" onClick={() => setSelected(item.id)}>Review</button></td>
            </tr>)}</tbody>
          </table></div>}
        </section>
        {selected && <SellerDetail key={selected} id={selected} onClose={() => setSelected(null)} onChanged={() => void reload()} />}
      </div>
    </>
  )
}

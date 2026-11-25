"use client"

import { useEffect, useRef, useState } from "react"
import type { FormEvent } from "react"
import { BellRing, Building2, FileSignature, MapPinned, Pencil, Plus, ShieldCheck } from "lucide-react"
import { api, displayDate, errorMessage } from "../lib/api"
import { useResource } from "./resource"
import { useSession } from "./session"
import { CoverageCheckout, PaymentDue } from "./coverage-checkout"
import { displayDay, displayLastDay, ErrorText, formatMoney, isoDay, PageHeading, StatusTag } from "./shared"
import type {
  AuthorizationScope, PaymentRecord, SellerAuthorizationInput, SellerCatalog, SellerOverview, SellerProfile, SellerProfileInput, SellerSubscriptionRecord,
} from "../../shared/contracts"

const text = (fields: FormData, name: string) => String(fields.get(name) ?? "").trim()

function ProfileForm({ profile, busy, onSubmit, onCancel }: {
  profile: SellerProfile | null
  busy: boolean
  onSubmit: (body: SellerProfileInput) => void
  onCancel?: () => void
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const san = text(fields, "san")
    onSubmit({
      legalName: text(fields, "legalName"),
      organizationId: text(fields, "organizationId"),
      ...san && { san },
      representative: {
        name: text(fields, "repName"), title: text(fields, "repTitle"), email: text(fields, "repEmail"), phone: text(fields, "repPhone"),
      },
    })
  }

  return (
    <form className="stack" onSubmit={submit}>
      <fieldset className="stack">
        <legend>Seller</legend>
        <div className="fields">
          <label>Legal name<input name="legalName" required minLength={2} maxLength={200} defaultValue={profile?.legal_name} autoComplete="organization" /></label>
          <label>Organization ID <small>EIN or registry ID</small><input name="organizationId" required maxLength={40} defaultValue={profile?.organization_id} placeholder="12-3456789" /></label>
          <label>Subscription Account Number (SAN)
            <input name="san" className="mono" required={!profile} maxLength={64} autoComplete="off" spellCheck={false}
              placeholder={profile ? `Current: ${profile.masked_san}. Leave blank to keep it.` : "As issued by the FTC"} />
          </label>
        </div>
      </fieldset>
      <fieldset className="stack">
        <legend>Authorized representative</legend>
        <div className="fields">
          <label>Full name<input name="repName" required minLength={2} maxLength={120} defaultValue={profile?.representative.name} autoComplete="name" /></label>
          <label>Title<input name="repTitle" required minLength={2} maxLength={120} defaultValue={profile?.representative.title} autoComplete="organization-title" /></label>
          <label>Email<input name="repEmail" type="email" required maxLength={254} defaultValue={profile?.representative.email} autoComplete="email" /></label>
          <label>Phone<input name="repPhone" type="tel" required maxLength={25} defaultValue={profile?.representative.phone} autoComplete="tel" /></label>
        </div>
      </fieldset>
      <p className="form-note">
        {profile
          ? "Changing the legal name, organization ID or SAN ends verified coverage until a reviewer verifies the profile again."
          : "Your SAN is encrypted and later shown only by its last four characters. Next, you choose coverage and pay; a reviewer then confirms your SAN with the FTC."}
      </p>
      <div className="button-row">
        <button className="button primary" disabled={busy}>{profile ? "Save profile" : "Save and continue"}</button>
        {onCancel && <button className="button" type="button" disabled={busy} onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  )
}

function AuthorizationForm({ overview, busy, onSubmit, onCancel }: {
  overview: SellerOverview
  busy: boolean
  onSubmit: (body: SellerAuthorizationInput) => void
  onCancel?: () => void
}) {
  const [channel, setChannel] = useState<"in_app" | "email">("in_app")
  const rep = overview.profile?.representative

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    onSubmit({
      signerName: text(fields, "signerName"), signerTitle: text(fields, "signerTitle"), signerEmail: text(fields, "signerEmail"),
      permittedScope: fields.getAll("scope").map(String) as AuthorizationScope[],
      expiresOn: text(fields, "expiresOn"), revocationChannel: channel,
      ...channel === "email" && { revocationContact: text(fields, "revocationContact") },
      consentTextVersion: overview.consent.version,
      electronicSignatureConsent: fields.get("consent") === "on",
    })
  }

  return (
    <form className="stack" onSubmit={submit}>
      <div className="fields">
        <label>Signer name<input name="signerName" required minLength={2} maxLength={120} defaultValue={rep?.name} /></label>
        <label>Signer title<input name="signerTitle" required minLength={2} maxLength={120} defaultValue={rep?.title} /></label>
        <label>Signer email<input name="signerEmail" type="email" required maxLength={254} defaultValue={rep?.email} /></label>
      </div>
      <fieldset>
        <legend>Permitted scope</legend>
        {(Object.entries(overview.scopes) as [AuthorizationScope, string][]).map(([id, label]) => (
          <label className="checkbox" key={id}><input type="checkbox" name="scope" value={id} defaultChecked /> {label}</label>
        ))}
      </fieldset>
      <div className="fields">
        <label>Expires on <small>Last valid day (UTC)</small><input name="expiresOn" type="date" required min={isoDay(2)} max={isoDay(399)} defaultValue={isoDay(364)} /></label>
        <label>Revocation channel
          <select value={channel} onChange={event => setChannel(event.target.value as "in_app" | "email")}>
            <option value="in_app">In this workspace</option>
            <option value="email">Email</option>
          </select>
        </label>
        {channel === "email" && <label>Revocation email<input name="revocationContact" type="email" required maxLength={254} /></label>}
      </div>
      <div className="consent">{overview.consent.text}</div>
      <label className="checkbox"><input type="checkbox" name="consent" required /> I agree to sign electronically. My typed name above is my signature.</label>
      <div className="button-row">
        <button className="button primary" disabled={busy}><FileSignature size={16} /> Sign authorization</button>
        {onCancel && <button className="button" type="button" disabled={busy} onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  )
}

function SubscriptionTable({ subscriptions }: { subscriptions: SellerSubscriptionRecord[] }) {
  return (
    <div className="table-wrap"><table>
      <thead><tr><th>Requested</th><th>Status</th><th>Plan</th><th>Area codes</th><th>Verified SAN period</th><th>Paid through</th></tr></thead>
      <tbody>{subscriptions.map(item => (
        <tr key={item.id}>
          <td>{displayDate(item.created_at)}</td>
          <td><StatusTag status={item.status} />{item.status_reason && <small className="form-note"><br />{item.status_reason}</small>}</td>
          <td>{item.billing_cycle ? `${formatMoney(item.amount_cents, item.currency ?? "usd")} / ${item.billing_cycle === "yearly" ? "year" : "month"}` : "—"}</td>
          <td className="mono wrap">{item.coverage_scope === "national" ? `All of America (${item.requested_area_codes.length})` : item.requested_area_codes.join(", ")}</td>
          <td>{item.period_start ? `${displayDay(item.period_start)} – ${displayLastDay(item.period_end)}` : "—"}</td>
          <td>{displayDay(item.paid_through)}</td>
        </tr>
      ))}</tbody>
    </table></div>
  )
}

export function SellerPage() {
  const { data, pending, error: loadError, reload } = useResource<SellerOverview>("/seller")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [signing, setSigning] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const [notice, setNotice] = useState("")
  const { data: catalog } = useResource<SellerCatalog>(data?.profile ? "/seller/billing/catalog" : null)
  const returned = useRef(false)
  const { user, refresh } = useSession()
  const accessSynced = useRef(false)
  const verified = Boolean(data?.subscriptions.some(item => item.status === "VERIFIED"))

  // Verification upgrades the account to reseller access on the server; reload the session once so the new pages appear.
  useEffect(() => {
    if (!data || accessSynced.current || !user) return
    if (verified !== user.isReseller) {
      accessSynced.current = true
      void refresh()
    }
  }, [data, verified, user, refresh])

  // Returning from Stripe Checkout: confirm the payment with the API, then clean the URL.
  useEffect(() => {
    if (returned.current) return
    const params = new URLSearchParams(window.location.search)
    const paymentId = params.get("payment")
    if (!paymentId) return
    returned.current = true
    window.history.replaceState(null, "", "/seller")
    if (params.get("checkout") === "cancelled") {
      setNotice("Card payment was cancelled. You can try again or pay by bank transfer.")
      return
    }
    // Without a webhook, pull the payment status from Stripe until it settles (about 30 seconds at most).
    setNotice("Confirming your card payment with Stripe…")
    void (async () => {
      try {
        for (let attempt = 0; attempt < 15; attempt++) {
          const payment = await api<PaymentRecord>(`/seller/billing/payments/${paymentId}/refresh`, { method: "POST" })
          if (payment.status === "PAID") {
            setNotice("Payment received. Your subscription is now waiting for FTC verification.")
            return
          }
          if (payment.status !== "PENDING") {
            setNotice("The card payment did not complete. You can try again or pay by bank transfer.")
            return
          }
          await new Promise(resolve => setTimeout(resolve, 2000))
        }
        setNotice("Stripe has not confirmed the payment yet. Use “Check payment status” in a moment.")
      } catch (error) { setError(errorMessage(error)) }
      finally { void reload() }
    })()
  }, [reload])
  const [confirmRevoke, setConfirmRevoke] = useState(false)

  async function run(work: () => Promise<unknown>, done?: () => void) {
    setBusy(true)
    setError("")
    try {
      await work()
      done?.()
      await reload()
    } catch (error) { setError(errorMessage(error)) }
    finally { setBusy(false) }
  }

  if (!data) {
    return <><PageHeading title="Seller profile" description="Register the seller and its FTC Subscription Account Number." />
      {pending ? <p role="status">Loading seller profile…</p> : <ErrorText error={loadError} />}</>
  }

  const { profile, authorization, subscriptions, coverage, notices } = data
  const hasOpenRequest = subscriptions.some(item => ["AWAITING_PAYMENT", "PENDING", "REVIEW_REQUIRED"].includes(item.status))
  const awaiting = subscriptions.find(item => item.status === "AWAITING_PAYMENT")
  const current = subscriptions.find(item => ["AWAITING_PAYMENT", "PENDING", "REVIEW_REQUIRED"].includes(item.status))
    ?? subscriptions.find(item => item.status === "VERIFIED") ?? subscriptions[0]
  const activeCoverage = coverage.filter(item => item.active)

  if (!profile) {
    return (
      <>
        <PageHeading title="Seller profile" description="Register the seller and its FTC Subscription Account Number." />
        <section className="card">
          <div className="card-heading"><span className="card-icon"><Building2 size={18} /></span><div><h2>Seller details</h2><p>A reviewer verifies the SAN and subscribed area codes with the FTC before coverage starts.</p></div></div>
          <ProfileForm profile={null} busy={busy} onSubmit={body => run(() => api("/seller", { method: "POST", body }))} />
          <ErrorText error={error} />
        </section>
      </>
    )
  }

  return (
    <>
      <PageHeading title="Seller profile" description="Your seller registration, authorization and verified area-code coverage."
        action={current && <StatusTag status={current.status} />} />
      <ErrorText error={error || loadError} />
      {notice && <p className="notice" role="status">{notice}</p>}
      {verified && user?.isReseller && <p className="notice">Your account is verified and has reseller access: screening, history, API keys, and your own users and roles are in the menu.</p>}
      <div className="seller-grid">
        <div className="stack">
          <section className="card">
            <div className="card-heading"><span className="card-icon"><Building2 size={18} /></span><div><h2>{profile.legal_name}</h2><p>Updated {displayDate(profile.updated_at)}</p></div></div>
            {editing
              ? <ProfileForm profile={profile} busy={busy} onCancel={() => setEditing(false)}
                  onSubmit={body => run(() => api("/seller", { method: "PUT", body }), () => setEditing(false))} />
              : <>
                <dl className="details">
                  <div><dt>Organization ID</dt><dd>{profile.organization_id}</dd></div>
                  <div><dt>SAN</dt><dd className="mono">{profile.masked_san}</dd></div>
                  <div><dt>Representative</dt><dd>{profile.representative.name}, {profile.representative.title}</dd></div>
                  <div><dt>Contact</dt><dd>{profile.representative.email} · {profile.representative.phone}</dd></div>
                </dl>
                <div className="button-row"><button className="button small" onClick={() => setEditing(true)}><Pencil size={14} /> Edit profile</button></div>
              </>}
          </section>

          <section className="card">
            <div className="card-heading"><span className="card-icon"><ShieldCheck size={18} /></span><div><h2>Coverage and subscription</h2><p>Choose where you call, pay, and we verify your SAN with the FTC before coverage starts.</p></div></div>
            {subscriptions.length > 0 && <SubscriptionTable subscriptions={subscriptions} />}
            {awaiting && <PaymentDue subscription={awaiting} bankInstructions={catalog?.bank_instructions ?? ""} cardEnabled={Boolean(catalog?.card_enabled)} onChanged={() => void reload()} />}
            {!hasOpenRequest && (choosing || !subscriptions.length
              ? <CoverageCheckout onDone={() => { setChoosing(false); void reload() }} />
              : <div className="button-row"><button className="button small" onClick={() => setChoosing(true)}><Plus size={14} /> Choose coverage for a new period</button></div>)}
          </section>

          <section className="card">
            <div className="card-heading"><span className="card-icon purple"><FileSignature size={18} /></span><div><h2>Seller authorization</h2><p>Authorizes this workspace, as your service provider, to use your SAN within the permitted scope.</p></div></div>
            {authorization && !signing && <>
              <dl className="details">
                <div><dt>Signed by</dt><dd>{authorization.signer_name}, {authorization.signer_title}</dd></div>
                <div><dt>Signed</dt><dd>{displayDate(authorization.signed_at)}</dd></div>
                <div><dt>Expires</dt><dd>{displayLastDay(authorization.expires_at)}</dd></div>
                <div><dt>Revocation channel</dt><dd>{authorization.revocation_channel === "email" ? `Email ${authorization.revocation_contact}` : "In this workspace"}</dd></div>
                <div><dt>Permitted scope</dt><dd>{authorization.permitted_scope.map(scope => data.scopes[scope]).join("; ")}</dd></div>
              </dl>
              <div className="button-row">
                <button className="button small" disabled={busy} onClick={() => setSigning(true)}>Replace authorization</button>
                <button className="button small danger" disabled={busy} onClick={() => setConfirmRevoke(true)}>Revoke</button>
              </div>
              {confirmRevoke && <div className="notice"><p>Revoke this authorization? Verified coverage ends immediately and needs a new authorization and review.</p>
                <div className="button-row">
                  <button className="button danger" disabled={busy} onClick={() => run(() => api(`/seller/authorizations/${authorization.id}/revoke`, { method: "POST", body: {} }), () => setConfirmRevoke(false))}>Revoke authorization</button>
                  <button className="button" disabled={busy} onClick={() => setConfirmRevoke(false)}>Cancel</button>
                </div></div>}
            </>}
            {(!authorization || signing) && <>
              {!authorization && <p className="notice">No active authorization. A reviewer cannot verify your subscription until you sign one.</p>}
              <AuthorizationForm overview={data} busy={busy} onCancel={signing ? () => setSigning(false) : undefined}
                onSubmit={body => run(() => api("/seller/authorizations", { method: "POST", body }), () => setSigning(false))} />
            </>}
          </section>
        </div>

        <div className="stack">
          <section className="card">
            <div className="card-heading"><span className="card-icon"><MapPinned size={18} /></span><div><h2>Verified coverage</h2><p>Area codes confirmed with the FTC for the current period.</p></div></div>
            {activeCoverage.length
              ? <><div className="code-list">{activeCoverage.map(item => <span className="tag clear" key={`${item.subscription_id}-${item.area_code}`}>{item.area_code}</span>)}</div>
                <p className="form-note" style={{ marginTop: 10 }}>Valid until the end of {displayLastDay(activeCoverage.map(item => item.valid_until).sort()[0])} (UTC).</p></>
              : <div className="empty inset"><MapPinned size={22} /><strong>No verified coverage</strong><p>Coverage starts after a reviewer verifies your subscription.</p></div>}
          </section>
          <section className="card">
            <div className="card-heading"><span className="card-icon"><BellRing size={18} /></span><div><h2>Notices</h2><p>Renewal and authorization reminders.</p></div></div>
            {notices.length
              ? <ul className="notice-list">{notices.map(notice => <li key={notice.id}>{notice.message}<small>{displayDate(notice.delivered_at ?? notice.due_at)}</small></li>)}</ul>
              : <p className="form-note">No notices yet.</p>}
          </section>
        </div>
      </div>
    </>
  )
}

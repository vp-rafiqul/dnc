"use client"

import { useState } from "react"
import { Copy, KeyRound, Plus, Terminal } from "lucide-react"
import { api, apiUrl, displayDate } from "../lib/api"
import { useResource } from "./resource"
import { useSession } from "./session"
import { ErrorText, PageHeading } from "./shared"

export function KeysPage() {
  const { user } = useSession()
  const can = permission => user.permissions.includes(permission)
  const canCreate = can("keys.create") && can("screening.api")
  const canList = can("keys.list")
  const canReveal = can("keys.reveal")
  const canEditRate = can("keys.update_rate_limit")
  const canRevoke = can("keys.revoke")
  const { data: keys, pending, error: listError, reload } = useResource(canList ? "/keys" : null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [issuedKey, setIssuedKey] = useState(null)
  const [copiedId, setCopiedId] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [editing, setEditing] = useState(null)
  const [detailsId, setDetailsId] = useState(null)
  const details = keys?.find(key => key.id === detailsId)

  async function create(event) {
    event.preventDefault()
    const form = event.currentTarget
    const fields = new FormData(form)
    const rate = fields.get("rateLimitPerMinute")
    const body = { name: fields.get("name") }
    if (rate) body.rateLimitPerMinute = Number(rate)
    setError("")
    setBusy(true)
    try {
      const key = await api("/keys", { method: "POST", body })
      setIssuedKey(key)
      setCopiedId(null)
      form.reset()
      await reload()
    } catch (error) { setError(error.message) }
    finally { setBusy(false) }
  }

  async function saveRate(event) {
    event.preventDefault()
    const rateLimitPerMinute = Number(new FormData(event.currentTarget).get("rateLimitPerMinute"))
    setBusy(true)
    setError("")
    try {
      await api(`/keys/${editing.id}`, { method: "PATCH", body: { rateLimitPerMinute } })
      setEditing(null)
      await reload()
    } catch (error) { setError(error.message) }
    finally { setBusy(false) }
  }

  async function revoke() {
    setBusy(true)
    setError("")
    try {
      await api(`/keys/${confirm.id}`, { method: "DELETE" })
      if (issuedKey?.id === confirm.id) setIssuedKey(null)
      if (copiedId === confirm.id) setCopiedId(null)
      setConfirm(null)
      await reload()
    } catch (error) { setError(error.message) }
    finally { setBusy(false) }
  }

  function openDetails(id) {
    setEditing(null)
    setConfirm(null)
    setError("")
    setDetailsId(id)
  }

  async function copyKey(key) {
    if (!key.secret && !key.can_reveal) {
      setError("This older key cannot be copied. Create a replacement key to get a copyable value.")
      return
    }
    setBusy(true)
    setError("")
    try {
      const value = key.secret ?? (await api(`/keys/${key.id}/secret`)).secret
      try {
        await navigator.clipboard.writeText(value)
        setCopiedId(key.id)
      } catch {
        setError("Clipboard access is unavailable. Allow clipboard access and try again.")
      }
    } catch (error) { setError(error.message) }
    finally { setBusy(false) }
  }

  return (
    <>
      <PageHeading title="API keys" description="Manage credentials for programmatic phone-number lookups." />
      <div className="stack">
        <section className="card">
          <div className="card-heading"><span className="card-icon"><KeyRound size={18} /></span><div><h2>Your keys</h2><p>API keys use your account’s current screening permission.</p></div></div>
          {canCreate && <form className="inline-form" onSubmit={create}>
            <label>Key name<input name="name" required maxLength={80} placeholder="e.g. CRM integration" /></label>
            {canEditRate && <label className="key-rate-field">Requests per minute<input name="rateLimitPerMinute" type="number" min={1} max={2147483647} placeholder="60" /></label>}
            <button className="button primary" disabled={busy}><Plus size={16} /> Create key</button>
          </form>}
          <ErrorText error={error || listError} />
          {issuedKey && <div className="notice stack"><strong>Copy your new API key</strong><div className="lookup-row"><input className="mono" aria-label="New API key" value={issuedKey.secret} readOnly onFocus={event => event.currentTarget.select()} /><button className="button" disabled={busy} onClick={() => copyKey(issuedKey)}><Copy size={16} /> {copiedId === issuedKey.id ? "Copied" : "Copy"}</button><button className="button" onClick={() => setIssuedKey(null)}>Dismiss</button></div></div>}
          {pending && !keys && <p role="status">Loading keys…</p>}
          {!canList && <p className="notice">Your role does not include permission to list API keys.</p>}
          {keys?.length === 0 && <div className="empty inset"><KeyRound size={23} /><strong>No API keys yet</strong></div>}
          {keys?.length > 0 && <div className="table-wrap"><table>
            <thead><tr><th>Name</th><th>Key prefix</th><th>Status</th><th>Requests/min</th><th>Created</th><th>Actions</th></tr></thead>
            <tbody>{keys.map(key => (
              <tr key={key.id}>
                <td>{key.name}</td><td className="mono">{key.prefix}…</td><td>{key.revoked_at ? "Revoked" : "Active"}</td>
                <td>{key.rate_limit_per_minute}</td><td>{displayDate(key.created_at)}</td>
                <td><div className="button-row">
                  {canReveal && <button className="button small" disabled={busy || Boolean(key.revoked_at)} onClick={() => copyKey(key)}><Copy size={14} /> {copiedId === key.id ? "Copied" : "Copy key"}</button>}
                  <button className="button small" disabled={busy} onClick={() => openDetails(key.id)}>View details</button>
                  {!key.revoked_at && canEditRate && <button className="button small" disabled={busy} onClick={() => { openDetails(null); setEditing(key) }}>Edit limit</button>}
                  {!key.revoked_at && canRevoke && <button className="button small" disabled={busy} onClick={() => { openDetails(null); setConfirm(key) }}>Revoke</button>}
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>}
          {details && <section className="notice stack" aria-label="API key details">
            <h2>{details.name}</h2>
            <dl className="details">
              <div><dt>Key prefix</dt><dd className="mono">{details.prefix}…</dd></div>
              <div><dt>Status</dt><dd>{details.revoked_at ? "Revoked" : "Active"}</dd></div>
              <div><dt>Requests per minute</dt><dd>{details.rate_limit_per_minute}</dd></div>
              <div><dt>Created</dt><dd>{displayDate(details.created_at)}</dd></div>
              {details.revoked_at && <div><dt>Revoked</dt><dd>{displayDate(details.revoked_at)}</dd></div>}
            </dl>
            <div className="button-row">
              <button className="button" disabled={busy} onClick={() => openDetails(null)}>Close details</button>
            </div>
          </section>}
          {editing && <div className="notice">
            <strong>Edit rate limit for {editing.name}</strong>
            <form className="inline-form" key={editing.id} onSubmit={saveRate}>
              <label className="key-rate-field">New requests per minute<input name="rateLimitPerMinute" type="number" min={1} max={2147483647} required defaultValue={editing.rate_limit_per_minute} /></label>
              <button className="button primary" disabled={busy}>Save limit</button>
              <button className="button" type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
            </form>
          </div>}
          {confirm && <div className="notice"><p>Revoke <strong>{confirm.name}</strong>? Requests using this key will stop working.</p><div className="button-row"><button className="button danger" disabled={busy} onClick={revoke}>Revoke key</button><button className="button" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button></div></div>}
        </section>
        <section className="card">
          <div className="card-heading"><span className="card-icon purple"><Terminal size={18} /></span><div><h2>Screening API</h2><p>Send one phone number per request with your API key.</p></div></div>
          <pre><code>{`POST ${apiUrl("/v1/screening/check")}\nX-API-Key: YOUR_API_KEY\nContent-Type: application/json\n\n{"phone":"+1 (212) 555-0100"}`}</code></pre>
        </section>
      </div>
    </>
  )
}

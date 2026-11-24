"use client"

import { useEffect, useState } from "react"
import { Copy, KeyRound, Plus, Terminal } from "lucide-react"
import { api, displayDate } from "../lib/api"
import { useResource } from "./resource"
import { useSession } from "./session"
import { ErrorText, PageHeading } from "./shared"

export function KeysPage() {
  const { user } = useSession()
  const can = permission => user.permissions.includes(permission)
  const canCreate = can("keys.create") && can("screening.api")
  const canList = can("keys.list")
  const { data: keys, pending, error: listError, reload } = useResource(canList ? "/keys" : null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [secret, setSecret] = useState("")
  const [copied, setCopied] = useState(false)
  const [confirm, setConfirm] = useState(null)
  const [apiUrl, setApiUrl] = useState("/api/v1/screening/check")
  useEffect(() => setApiUrl(new URL("/api/v1/screening/check", location.origin).href), [])

  async function create(event) {
    event.preventDefault()
    const form = event.currentTarget
    setError("")
    setBusy(true)
    try {
      const key = await api("/keys", { method: "POST", body: Object.fromEntries(new FormData(form)) })
      setSecret(key.secret)
      setCopied(false)
      form.reset()
      await reload()
    } catch (error) { setError(error.message) }
    finally { setBusy(false) }
  }

  async function revoke() {
    setBusy(true)
    setError("")
    try {
      await api(`/keys/${confirm.id}`, { method: "DELETE" })
      setConfirm(null)
      await reload()
    } catch (error) { setError(error.message) }
    finally { setBusy(false) }
  }

  async function copy() {
    try { await navigator.clipboard.writeText(secret); setCopied(true) }
    catch { setError("Clipboard unavailable. Select and copy the key manually.") }
  }

  return (
    <>
      <PageHeading title="API keys" description="Manage credentials for programmatic phone-number lookups." />
      <div className="stack">
        <section className="card">
          <div className="card-heading"><span className="card-icon"><KeyRound size={18} /></span><div><h2>Your keys</h2><p>API keys use your account’s current screening permission.</p></div></div>
          {canCreate && <form className="inline-form" onSubmit={create}><label>Key name<input name="name" required maxLength={80} placeholder="e.g. CRM integration" /></label><button className="button primary" disabled={busy}><Plus size={16} /> Create key</button></form>}
          <ErrorText error={error || listError} />
          {secret && <div className="notice stack" role="status"><strong>Copy your new key now. It is shown once.</strong><div className="lookup-row"><input className="mono" aria-label="New API key" value={secret} readOnly onFocus={event => event.currentTarget.select()} /><button className="button" onClick={copy}><Copy size={16} /> {copied ? "Copied" : "Copy"}</button><button className="button" onClick={() => setSecret("")}>Dismiss</button></div></div>}
          {pending && !keys && <p role="status">Loading keys…</p>}
          {!canList && <p className="notice">Your role does not include permission to list API keys.</p>}
          {keys?.length === 0 && <div className="empty inset"><KeyRound size={23} /><strong>No API keys yet</strong></div>}
          {keys?.length > 0 && <div className="table-wrap"><table>
            <thead><tr><th>Name</th><th>Key prefix</th><th>Status</th><th>Created</th>{can("keys.revoke") && <th>Actions</th>}</tr></thead>
            <tbody>{keys.map(key => <tr key={key.id}><td>{key.name}</td><td className="mono">{key.prefix}…</td><td>{key.revoked_at ? "Revoked" : "Active"}</td><td>{displayDate(key.created_at)}</td>{can("keys.revoke") && <td>{!key.revoked_at && <button className="button small" onClick={() => setConfirm(key)}>Revoke</button>}</td>}</tr>)}</tbody>
          </table></div>}
          {confirm && <div className="notice"><p>Revoke <strong>{confirm.name}</strong>? Requests using this key will stop working.</p><div className="button-row"><button className="button danger" disabled={busy} onClick={revoke}>Revoke key</button><button className="button" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button></div></div>}
        </section>
        <section className="card">
          <div className="card-heading"><span className="card-icon purple"><Terminal size={18} /></span><div><h2>Screening API</h2><p>Send one phone number per request with your API key.</p></div></div>
          <pre><code>{`POST ${apiUrl}\nContent-Type: application/json\nX-API-Key: YOUR_API_KEY\n\n{"phone":"+1 (212) 555-0100"}`}</code></pre>
        </section>
      </div>
    </>
  )
}

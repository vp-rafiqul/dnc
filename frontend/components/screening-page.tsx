"use client"

import { useRef, useState } from "react"
import type { FormEvent } from "react"
import { CircleCheck, Database, FlaskConical, Phone, ScanLine, Search } from "lucide-react"
import { useWorkspaceUser } from "./session"
import { ErrorText, PageHeading, ResultTag } from "./shared"
import { api, displayDate, errorMessage } from "../lib/api"
import type { ScreeningResult } from "../../shared/contracts"

const examples = [
  { phone: "(212) 555-0100", label: "Federal + state match" },
  { phone: "(305) 555-0123", label: "State-only match" },
  { phone: "(415) 555-0134", label: "No match" },
]

export function ScreeningPage() {
  const user = useWorkspaceUser()
  const allowed = user.permissions.includes("screening.check")
  const [phone, setPhone] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<ScreeningResult | null>(null)
  const input = useRef<HTMLInputElement>(null)

  async function check(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError("")
    setResult(null)
    try { setResult(await api<ScreeningResult>("/screening/check", { method: "POST", body: { phone } })) }
    catch (error) { setError(errorMessage(error)) }
    finally { setBusy(false) }
  }

  return (
    <>
      <PageHeading title="Screening" description="Check a US phone number against the synthetic Do Not Call dataset." />
      <div className="screening-grid">
        <div className="stack">
          <section className="card">
            <div className="card-heading"><span className="card-icon"><Phone size={18} /></span><div><h2>Phone number lookup</h2><p>Enter a 10-digit number. The +1 country code is optional.</p></div></div>
            {allowed ? (
              <form className="lookup-form" onSubmit={check}>
                <label htmlFor="phone">Phone number</label>
                <div className="lookup-row">
                  <input ref={input} id="phone" type="tel" value={phone} onChange={event => setPhone(event.target.value)} placeholder="(212) 555-0100" maxLength={40} required />
                  <button className="button primary" disabled={busy || !phone.trim()}><Search size={17} /> {busy ? "Checking…" : "Check number"}</button>
                </div>
                <ErrorText error={error} />
              </form>
            ) : <p className="notice">Your role does not include permission to check numbers.</p>}
          </section>
          <section className="card" aria-live="polite">
            <div className="card-heading"><span className="card-icon"><ScanLine size={18} /></span><div><h2>Screening result</h2><p>Matches from the active synthetic snapshot.</p></div></div>
            {result ? (
              <div className="result">
                <div className="result-title"><span className="mono">{result.phone}</span><ResultTag exists={result.exists} /></div>
                <dl className="details">
                  <div><dt>Federal list</dt><dd>{result.federalMatch ? "Match" : "No match"}</dd></div>
                  <div><dt>State lists</dt><dd>{result.stateMatches.join(", ") || "No match"}</dd></div>
                  <div><dt>Snapshot</dt><dd>{result.generation}</dd></div>
                  <div><dt>Checked</dt><dd>{displayDate(result.checkedAt)}</dd></div>
                </dl>
              </div>
            ) : (
              <div className="empty inset"><span className="empty-icon"><Search size={22} /></span><strong>{busy ? "Checking the dataset…" : "No result yet"}</strong><p>{busy ? "This should only take a moment." : "Run a lookup to see the result here."}</p></div>
            )}
          </section>
        </div>
        <div className="stack">
          <section className="card">
            <div className="card-heading"><span className="card-icon purple"><FlaskConical size={18} /></span><div><h2>Example numbers</h2><p>Try one of these fictional numbers.</p></div></div>
            <div className="example-list">{examples.map(example => <button type="button" className="example" key={example.phone} disabled={!allowed || busy} onClick={() => { setPhone(example.phone); input.current?.focus() }}><span><strong className="mono">{example.phone}</strong><small>{example.label}</small></span><CircleCheck size={17} /></button>)}</div>
          </section>
          <section className="card dataset">
            <div className="card-heading"><span className="card-icon"><Database size={18} /></span><div><h2>About this dataset</h2><p>This workspace uses fictional federal and state records for testing. Use an authorized registry for actual screening.</p></div></div>
          </section>
        </div>
      </div>
    </>
  )
}

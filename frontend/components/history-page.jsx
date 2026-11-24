"use client"

import { Clock3, RefreshCw } from "lucide-react"
import { displayDate } from "../lib/api"
import { useResource } from "./resource"
import { useSession } from "./session"
import { ErrorText, PageHeading, ResultTag } from "./shared"

export function HistoryPage() {
  const { user } = useSession()
  const allowed = user.permissions.includes("history.read")
  const { data, pending, error, reload } = useResource(allowed ? "/screening/history" : null)

  return (
    <>
      <PageHeading title="History" description="Your last 50 lookups from the workspace and API."
        action={allowed && <button className="button" disabled={pending} onClick={() => reload()}><RefreshCw size={16} /> Refresh</button>} />
      <section className="card">
        {!allowed && <p className="notice">Your role does not include permission to read screening history.</p>}
        {pending && !data && <p role="status">Loading history…</p>}
        <ErrorText error={error} />
        {data?.length === 0 && <div className="empty"><Clock3 size={24} /><h2>No lookups yet</h2><p>Your screening activity will appear here.</p></div>}
        {data?.length > 0 && <div className="table-wrap"><table>
          <thead><tr><th>Phone number</th><th>Result</th><th>Channel</th><th>Snapshot</th><th>Checked</th></tr></thead>
          <tbody>{data.map(event => <tr key={event.id}><td className="mono">{event.masked_phone}</td><td><ResultTag exists={event.exists_in_registry} /></td><td>{event.channel === "api" ? "API" : "Workspace"}</td><td>{event.generation_id}</td><td>{displayDate(event.checked_at)}</td></tr>)}</tbody>
        </table></div>}
      </section>
    </>
  )
}

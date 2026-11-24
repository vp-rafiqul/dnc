"use client"

import { useMemo, useState } from "react"
import type { FormEvent } from "react"
import { Clock3, Download, RefreshCw } from "lucide-react"
import { api, displayDate, errorMessage } from "../lib/api"
import { useResource } from "./resource"
import { useWorkspaceUser } from "./session"
import { ErrorText, PageHeading, ResultTag } from "./shared"
import type { HistoryFilters, HistoryPageData, HistoryReportFormat } from "../../shared/contracts"

const formats: [HistoryReportFormat, string][] = [["csv", "CSV"], ["xlsx", "Excel"], ["pdf", "PDF"]]
const historyPath = "/screening/history"

function dateBoundary(value: string, nextDay = false) {
  if (!value) return undefined
  const date = new Date(`${value}T00:00:00`)
  if (nextDay) date.setDate(date.getDate() + 1)
  return date.toISOString()
}

export function HistoryPage() {
  const user = useWorkspaceUser()
  const allowed = user.permissions.includes("history.read")
  const [filters, setFilters] = useState<HistoryFilters>({})
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [filterError, setFilterError] = useState("")
  const [exportError, setExportError] = useState("")
  const [exporting, setExporting] = useState<HistoryReportFormat | "">("")
  const query = useMemo(() => ({ method: "POST", body: { ...filters, page, pageSize } }), [filters, page, pageSize])
  const { data, pending, error, reload } = useResource<HistoryPageData>(allowed ? historyPath : null, query)
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const start = String(fields.get("start") ?? "")
    const end = String(fields.get("end") ?? "")
    const channel = fields.get("channel")
    const phone = String(fields.get("phone") ?? "")
    setFilterError("")
    setExportError("")
    if (start && end && end < start) {
      setFilterError("The end date must be on or after the start date.")
      return
    }
    setFilters({
      from: dateBoundary(start), until: dateBoundary(end, true),
      channel: channel === "web" || channel === "api" ? channel : undefined,
      phone: phone.trim() || undefined,
    })
    setPage(1)
  }

  function clearFilters() {
    setFilters({})
    setPage(1)
    setFilterError("")
    setExportError("")
  }

  async function download(format: HistoryReportFormat) {
    setExporting(format)
    setExportError("")
    try {
      const report = await api(`${historyPath}/export/${format}`, { method: "POST", body: filters, responseType: "blob" })
      const url = URL.createObjectURL(report)
      const link = document.createElement("a")
      link.href = url
      link.download = `screening-history.${format}`
      document.body.append(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) { setExportError(errorMessage(error)) }
    finally { setExporting("") }
  }

  return (
    <>
      <PageHeading title="History" description="Browse and export your screening activity from the workspace and API."
        action={allowed && <button className="button" disabled={pending} onClick={() => reload()}><RefreshCw size={16} /> Refresh</button>} />
      <section className="card">
        {!allowed ? <p className="notice">Your role does not include permission to read screening history.</p> : <>
          <form className="history-filters" onSubmit={applyFilters} onReset={clearFilters} aria-label="History filters">
            <label>From date<input type="date" name="start" /></label>
            <label>To date<input type="date" name="end" /></label>
            <label>Channel<select name="channel"><option value="">All channels</option><option value="web">Workspace</option><option value="api">API</option></select></label>
            <label>Phone number<input name="phone" type="tel" placeholder="Any digits, e.g. 0100" maxLength={40} /></label>
            <div className="button-row"><button className="button primary">Apply filters</button><button className="button" type="reset">Clear</button></div>
          </form>
          <ErrorText error={filterError || error} />
          <div className="history-toolbar">
            <p aria-live="polite">{pending ? "Loading history…" : data && `${data.total.toLocaleString()} matching lookups`}</p>
            <div className="button-row" role="group" aria-label="Download filtered history">
              {formats.map(([format, label]) =>
                <button key={format} className="button" disabled={pending || !data || Boolean(exporting)} onClick={() => download(format)}>
                  <Download size={15} /> {exporting === format ? "Preparing…" : label}
                </button>
              )}
            </div>
          </div>
          <ErrorText error={exportError} />
          {data?.items.length === 0 && <div className="empty"><Clock3 size={24} /><h2>No matching lookups</h2><p>Try changing the filters.</p></div>}
          {data && data.items.length > 0 && <div className="table-wrap"><table>
            <thead><tr><th>Phone number</th><th>Result</th><th>Channel</th><th>Snapshot</th><th>Checked</th></tr></thead>
            <tbody>{data.items.map(event => <tr key={event.id}><td className="mono">{event.masked_phone}</td><td><ResultTag exists={event.exists_in_registry} /></td><td>{event.channel === "api" ? "API" : "Workspace"}</td><td>{event.generation_id}</td><td>{displayDate(event.checked_at)}</td></tr>)}</tbody>
          </table></div>}
          <div className="history-pagination">
            <label>Rows per page<select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1) }}>
              {[10, 25, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}
            </select></label>
            {data && <nav aria-label="History pagination">
              <button className="button" disabled={pending || data.page <= 1} onClick={() => setPage(data.page - 1)}>Previous</button>
              <span aria-live="polite">Page {data.page} of {totalPages}</span>
              <button className="button" disabled={pending || data.page >= totalPages} onClick={() => setPage(data.page + 1)}>Next</button>
            </nav>}
          </div>
        </>}
      </section>
    </>
  )
}

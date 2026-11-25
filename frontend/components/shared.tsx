import { CircleAlert } from "lucide-react"
import type { ReactNode } from "react"
import type { SellerSubscriptionStatus } from "../../shared/contracts"

export function PageHeading({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading"><div><h1>{title}</h1><p>{description}</p></div>{action}</div>
}

export function ErrorText({ error }: { error: string }) {
  return error ? <p className="error" role="alert"><CircleAlert size={16} /> {error}</p> : null
}

export function ResultTag({ exists }: { exists: boolean }) {
  return <span className={`tag ${exists ? "match" : "clear"}`}>{exists ? "Match found" : "No match"}</span>
}

const statusLabels: Record<SellerSubscriptionStatus, string> = {
  AWAITING_PAYMENT: "Awaiting payment", CANCELLED: "Cancelled", PENDING: "Paid · pending verification", VERIFIED: "Verified", REJECTED: "Rejected", REVIEW_REQUIRED: "Review required", EXPIRED: "Expired",
}
const statusTone: Record<SellerSubscriptionStatus, string> = {
  AWAITING_PAYMENT: "match", CANCELLED: "", PENDING: "match", VERIFIED: "clear", REJECTED: "rejected", REVIEW_REQUIRED: "match", EXPIRED: "",
}

export function StatusTag({ status }: { status: SellerSubscriptionStatus | null }) {
  return status ? <span className={`tag ${statusTone[status]}`}>{statusLabels[status]}</span> : <span className="tag">No request</span>
}

export function parseAreaCodes(value: FormDataEntryValue | null) {
  return String(value ?? "").split(/[\s,;]+/).map(code => code.trim()).filter(Boolean)
}

export function displayDay(value: string | null) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value)) : "—"
}

/** Verified end dates are stored as the first instant after the last valid day. */
export function displayLastDay(value: string | null) {
  return value ? displayDay(new Date(new Date(value).getTime() - 1).toISOString()) : "—"
}

export function isoDay(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10)
}

export function formatMoney(cents: number | null, currency = "usd") {
  if (cents === null) return "—"
  return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() }).format(cents / 100)
}

export function toCents(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim()
  if (!text) return null
  const amount = Number(text)
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : Number.NaN
}

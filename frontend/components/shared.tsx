import { CircleAlert } from "lucide-react"
import type { ReactNode } from "react"

export function PageHeading({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading"><div><h1>{title}</h1><p>{description}</p></div>{action}</div>
}

export function ErrorText({ error }: { error: string }) {
  return error ? <p className="error" role="alert"><CircleAlert size={16} /> {error}</p> : null
}

export function ResultTag({ exists }: { exists: boolean }) {
  return <span className={`tag ${exists ? "match" : "clear"}`}>{exists ? "Match found" : "No match"}</span>
}

import { CircleAlert } from "lucide-react"

export function PageHeading({ title, description, action }) {
  return <div className="page-heading"><div><h1>{title}</h1><p>{description}</p></div>{action}</div>
}

export function ErrorText({ error }) {
  return error ? <p className="error" role="alert"><CircleAlert size={16} /> {error}</p> : null
}

export function ResultTag({ exists }) {
  return <span className={`tag ${exists ? "match" : "clear"}`}>{exists ? "Match found" : "No match"}</span>
}

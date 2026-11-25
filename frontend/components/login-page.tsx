"use client"

import { useEffect, useState } from "react"
import type { FormEvent } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { LockKeyhole, Store } from "lucide-react"
import { useSession } from "./session"
import { ThemeSwitch } from "./theme"
import { Brand } from "./workspace"
import { errorMessage } from "../lib/api"
import type { Permission } from "../../shared/contracts"

export function LoginPage({ mode = "login" }: { mode?: "login" | "register" }) {
  const { user, login, register } = useSession()
  const registering = mode === "register"
  const router = useRouter()
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!user) return
    const routes: [Permission, string][] = [
      ["page.screening", "/screening"], ["page.history", "/history"], ["page.keys", "/api-keys"],
      ["page.seller", "/seller"], ["page.users", "/users"], ["page.roles", "/roles"], ["page.seller_review", "/seller-review"], ["page.billing", "/billing"],
    ]
    const first = routes.find(([permission]) => user.permissions.includes(permission))
    router.replace(first?.[1] || "/screening")
  }, [user, router])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError("")
    const fields = new FormData(event.currentTarget)
    const email = String(fields.get("email") ?? "")
    const password = String(fields.get("password") ?? "")
    try {
      if (!registering) await login({ email, password })
      else if (password !== fields.get("confirm")) setError("The passwords do not match.")
      else await register({ name: String(fields.get("name") ?? ""), email, password })
    }
    catch (error) { setError(errorMessage(error)) }
    finally { setBusy(false) }
  }

  return (
    <main className="login">
      <header><Brand /><ThemeSwitch /></header>
      <section className="card login-card">
        <span className="workspace-icon">{registering ? <Store size={23} /> : <LockKeyhole size={23} />}</span>
        <h1>{registering ? "Create a seller account" : "Sign in"}</h1>
        <p>{registering ? "Register your business, choose DNC coverage and pay online." : "Access your screening workspace."}</p>
        <form className="stack" onSubmit={submit}>
          {registering && <label>Your name<input autoComplete="name" name="name" required minLength={2} maxLength={80} /></label>}
          <label>Email<input autoComplete={registering ? "email" : "username"} type="email" name="email" placeholder="you@example.com" required /></label>
          <label>Password{registering && <small> At least 12 characters</small>}
            <input autoComplete={registering ? "new-password" : "current-password"} type="password" name="password" required minLength={registering ? 12 : undefined} maxLength={128} />
          </label>
          {registering && <label>Confirm password<input autoComplete="new-password" type="password" name="confirm" required minLength={12} maxLength={128} /></label>}
          {error && <p className="error" role="alert">{error}</p>}
          <button className="button primary" disabled={busy}>{busy ? (registering ? "Creating account…" : "Signing in…") : registering ? "Create account" : "Sign in"}</button>
        </form>
        <p className="form-note" style={{ marginTop: 16, textAlign: "center" }}>
          {registering ? <>Already have an account? <Link className="text-link" href="/login">Sign in</Link></>
            : <>New seller? <Link className="text-link" href="/register">Create a seller account</Link></>}
        </p>
      </section>
    </main>
  )
}

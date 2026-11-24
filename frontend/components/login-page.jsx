"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { LockKeyhole } from "lucide-react"
import { useSession } from "./session"
import { ThemeSwitch } from "./theme"
import { Brand } from "./workspace"

export function LoginPage() {
  const { user, login } = useSession()
  const router = useRouter()
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!user) return
    const first = [
      ["page.screening", "/screening"], ["page.history", "/history"], ["page.keys", "/api-keys"],
      ["page.users", "/users"], ["page.roles", "/roles"],
    ].find(([permission]) => user.permissions.includes(permission))
    router.replace(first?.[1] || "/screening")
  }, [user, router])

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError("")
    try { await login(Object.fromEntries(new FormData(event.currentTarget))) }
    catch (error) { setError(error.message) }
    finally { setBusy(false) }
  }

  return (
    <main className="login">
      <header><Brand /><ThemeSwitch /></header>
      <section className="card login-card">
        <span className="workspace-icon"><LockKeyhole size={23} /></span>
        <h1>Sign in</h1>
        <p>Access your screening workspace.</p>
        <form className="stack" onSubmit={submit}>
          <label>Email<input autoComplete="username" type="email" name="email" placeholder="you@example.com" required /></label>
          <label>Password<input autoComplete="current-password" type="password" name="password" required /></label>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="button primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>
      </section>
    </main>
  )
}

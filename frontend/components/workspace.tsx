"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import type { ReactNode } from "react"
import { BadgeCheck, Building2, CircleDollarSign, ChevronRight, Clock3, FlaskConical, KeyRound, LogOut, PanelLeft, ScanLine, Shield, ShieldCheck, UsersRound } from "lucide-react"
import { ThemeSwitch } from "./theme"
import { useSession } from "./session"
import { errorMessage } from "../lib/api"
import type { Permission } from "../../shared/contracts"

const sections = [
  { href: "/screening", label: "Screening", permission: "page.screening", icon: ScanLine },
  { href: "/history", label: "History", permission: "page.history", icon: Clock3 },
  { href: "/api-keys", label: "API keys", permission: "page.keys", icon: KeyRound },
  { href: "/seller", label: "Seller profile", permission: "page.seller", icon: Building2 },
  { href: "/users", label: "Users", permission: "page.users", icon: UsersRound, admin: true },
  { href: "/roles", label: "Roles", permission: "page.roles", icon: Shield, admin: true },
  { href: "/seller-review", label: "Seller verification", permission: "page.seller_review", icon: BadgeCheck, admin: true },
  { href: "/billing", label: "Billing", permission: "page.billing", icon: CircleDollarSign, admin: true },
] satisfies { href: string; label: string; permission: Permission; icon: typeof Shield; admin?: boolean }[]

export function Brand() {
  return <span className="brand"><span className="brand-mark"><ShieldCheck size={22} /></span><span>DNC Screening</span></span>
}

export function Workspace({ children }: { children: ReactNode }) {
  const { user, error, restoring, logout, refresh } = useSession()
  const pathname = usePathname()
  const router = useRouter()
  const [sidebar, setSidebar] = useState(false)
  const [signOutError, setSignOutError] = useState("")
  const page = sections.find(item => item.href === pathname)
  const visible = sections.filter(item => user?.permissions.includes(item.permission))

  useEffect(() => {
    if (user === null && !error) router.replace("/login")
  }, [user, error, router])

  if (error && !user) return <main className="center-state"><p role="alert">{error}</p><button className="button" disabled={restoring} onClick={refresh}>{restoring ? "Retrying…" : "Retry"}</button></main>
  if (!user) return <main className="center-state"><p role="status">Opening workspace…</p></main>

  async function signOut() {
    try { await logout() } catch (error) { setSignOutError(errorMessage(error)) }
  }

  function link(item: (typeof sections)[number]) {
    return (
      <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined} onClick={() => setSidebar(false)}>
        <item.icon size={18} /> {item.label}
      </Link>
    )
  }

  return (
    <div className="workspace">
      <aside className={`sidebar ${sidebar ? "sidebar-open" : ""}`} id="workspace-sidebar">
        <div className="sidebar-brand"><Brand /></div>
        <nav className="side-nav" aria-label="Workspace navigation">
          {visible.some(item => !item.admin) && <><div className="nav-label">Workspace</div>{visible.filter(item => !item.admin).map(link)}</>}
          {visible.some(item => item.admin) && <><div className="nav-label">Administration</div>{visible.filter(item => item.admin).map(link)}</>}
        </nav>
        <div className="sidebar-bottom">
          <ThemeSwitch />
          <div className="account">
            <span className="avatar">{user.name.slice(0, 2).toUpperCase()}</span>
            <span className="account-meta"><strong>{user.name}</strong><small>{user.role}</small></span>
            <button className="icon-button" aria-label="Sign out" title="Sign out" onClick={signOut}><LogOut size={17} /></button>
          </div>
          {signOutError && <p role="alert" className="error">{signOutError}</p>}
        </div>
      </aside>
      {sidebar && <button className="scrim" aria-label="Close navigation" onClick={() => setSidebar(false)} />}
      <div className="main-shell">
        <header className="utility">
          <button className="icon-button mobile-menu" aria-label="Toggle navigation" aria-controls="workspace-sidebar" aria-expanded={sidebar} onClick={() => setSidebar(!sidebar)}><PanelLeft size={20} /></button>
          <div className="breadcrumb">Workspace <ChevronRight size={14} /> <strong>{page?.label}</strong></div>
          <span className="tag synthetic"><FlaskConical size={14} /> Synthetic data</span>
        </header>
        <div className="workspace-header">
          <div className="workspace-title"><span className="workspace-icon"><ShieldCheck size={25} /></span><div><strong>DNC Screening</strong><p>Do Not Call screening workspace</p></div></div>
        </div>
        <main className="content">
          {page && !user.permissions.includes(page.permission)
            ? <section className="card empty"><Shield size={24} /><h1>Page access unavailable</h1><p>Your role does not include access to this page.</p>{visible[0] && <Link className="button" href={visible[0].href}>Open {visible[0].label}</Link>}</section>
            : children}
        </main>
      </div>
    </div>
  )
}

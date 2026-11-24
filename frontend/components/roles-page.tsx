"use client"

import { useState } from "react"
import type { FormEvent } from "react"
import { Plus, Shield } from "lucide-react"
import { api, errorMessage } from "../lib/api"
import { useResource } from "./resource"
import { useWorkspaceUser } from "./session"
import { ErrorText, PageHeading } from "./shared"
import type { Permission, PermissionCatalog, Role, RoleCatalog } from "../../shared/contracts"

interface RoleEditorProps {
  role: Partial<Role>
  catalog: PermissionCatalog
  close: () => void
  saved: () => Promise<void>
}

function RoleEditor({ role, catalog, close, saved }: RoleEditorProps) {
  const [selected, setSelected] = useState<Permission[]>(role.permissions || [])
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = new FormData(event.currentTarget).get("name")
    setBusy(true)
    setError("")
    try {
      await api(role.id ? `/admin/roles/${role.id}` : "/admin/roles",
        { method: role.id ? "PUT" : "POST", body: { name, permissions: selected } })
      await saved()
    } catch (error) { setError(errorMessage(error)) }
    finally { setBusy(false) }
  }

  function toggle(id: Permission) {
    setSelected(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id])
  }

  return (
    <section className="card stack">
      <h2>{role.id ? "Edit role" : "New role"}</h2>
      <form className="stack" onSubmit={submit}>
        <label>Role name<input name="name" defaultValue={role.name} maxLength={60} required /></label>
        <div className="permission-grid">{Object.entries(catalog).map(([group, values]) => (
          <fieldset key={group}><legend>{group === "pages" ? "Page access" : "Function access"}</legend>
            {(Object.keys(values) as Permission[]).map(id => <label key={id} className="checkbox"><input type="checkbox" checked={selected.includes(id)} onChange={() => toggle(id)} /> {values[id]}</label>)}
          </fieldset>
        ))}</div>
        <ErrorText error={error} />
        <div className="button-row"><button className="button primary" disabled={busy}>Save role</button><button type="button" className="button" disabled={busy} onClick={close}>Cancel</button></div>
      </form>
    </section>
  )
}

export function RolesPage() {
  const user = useWorkspaceUser()
  const allowed = user.permissions.includes("roles.list")
  const canManageRoles = user.isSuperAdmin || user.isReseller
  const { data, pending, error, reload } = useResource<RoleCatalog>(allowed ? "/admin/roles" : null)
  const [editing, setEditing] = useState<Partial<Role> | null>(null)

  return (
    <>
      <PageHeading title="Roles" description="Choose which pages and actions each role can access."
        action={canManageRoles && <button className="button primary" disabled={!data} onClick={() => setEditing({})}><Plus size={17} /> New role</button>} />
      <div className="stack">
        {editing && data && <RoleEditor key={editing.id || "new"} role={editing} catalog={editing.reseller_id ? data.resellerCatalog : data.catalog} close={() => setEditing(null)} saved={async () => { setEditing(null); await reload() }} />}
        <section className="card">
          <div className="card-heading"><span className="card-icon"><Shield size={18} /></span><div><h2>Workspace roles</h2><p>Assign roles to accounts on the Users page.</p></div></div>
          {!allowed && <p className="notice">Your role does not include permission to view roles.</p>}
          {pending && !data && <p role="status">Loading roles…</p>}
          <ErrorText error={error} />
          {data && <div className="table-wrap"><table>
            <thead><tr><th>Role</th>{user.isSuperAdmin && <th>Reseller</th>}<th>Page access</th><th>Function access</th>{canManageRoles && <th>Actions</th>}</tr></thead>
            <tbody>{data.roles.map(role => <tr key={role.id}><td><strong>{role.name}</strong></td>{user.isSuperAdmin && <td>{role.reseller || "—"}</td>}<td>{role.is_super_admin ? "All" : role.permissions.filter(id => id in data.catalog.pages).length}</td><td>{role.is_super_admin ? "All" : role.permissions.filter(id => id in data.catalog.actions).length}</td>{canManageRoles && <td>{role.is_super_admin || role.is_reseller ? "Built-in role" : <button className="button small" onClick={() => setEditing(role)}>Edit</button>}</td>}</tr>)}</tbody>
          </table></div>}
        </section>
      </div>
    </>
  )
}

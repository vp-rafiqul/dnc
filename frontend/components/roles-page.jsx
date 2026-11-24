"use client"

import { useState } from "react"
import { Plus, Shield } from "lucide-react"
import { api } from "../lib/api"
import { useResource } from "./resource"
import { useSession } from "./session"
import { ErrorText, PageHeading } from "./shared"

function RoleEditor({ role, catalog, close, saved }) {
  const [selected, setSelected] = useState(role.permissions || [])
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    const name = new FormData(event.currentTarget).get("name")
    setBusy(true)
    setError("")
    try {
      await api(role.id ? `/admin/roles/${role.id}` : "/admin/roles",
        { method: role.id ? "PUT" : "POST", body: { name, permissions: selected } })
      await saved()
    } catch (error) { setError(error.message) }
    finally { setBusy(false) }
  }

  function toggle(id) {
    setSelected(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id])
  }

  return (
    <section className="card stack">
      <h2>{role.id ? "Edit role" : "New role"}</h2>
      <form className="stack" onSubmit={submit}>
        <label>Role name<input name="name" defaultValue={role.name} maxLength={60} required /></label>
        <div className="permission-grid">{Object.entries(catalog).map(([group, values]) => (
          <fieldset key={group}><legend>{group === "pages" ? "Page access" : "Function access"}</legend>
            {Object.entries(values).map(([id, label]) => <label key={id} className="checkbox"><input type="checkbox" checked={selected.includes(id)} onChange={() => toggle(id)} /> {label}</label>)}
          </fieldset>
        ))}</div>
        <ErrorText error={error} />
        <div className="button-row"><button className="button primary" disabled={busy}>Save role</button><button type="button" className="button" disabled={busy} onClick={close}>Cancel</button></div>
      </form>
    </section>
  )
}

export function RolesPage() {
  const { user } = useSession()
  const allowed = user.permissions.includes("roles.list")
  const { data, pending, error, reload } = useResource(allowed ? "/admin/roles" : null)
  const [editing, setEditing] = useState(null)

  return (
    <>
      <PageHeading title="Roles" description="Choose which pages and actions each role can access."
        action={user.isSuperAdmin && <button className="button primary" disabled={!data} onClick={() => setEditing({})}><Plus size={17} /> New role</button>} />
      <div className="stack">
        {editing && <RoleEditor key={editing.id || "new"} role={editing} catalog={data.catalog} close={() => setEditing(null)} saved={async () => { setEditing(null); await reload() }} />}
        <section className="card">
          <div className="card-heading"><span className="card-icon"><Shield size={18} /></span><div><h2>Workspace roles</h2><p>Assign roles to accounts on the Users page.</p></div></div>
          {!allowed && <p className="notice">Your role does not include permission to view roles.</p>}
          {pending && !data && <p role="status">Loading roles…</p>}
          <ErrorText error={error} />
          {data && <div className="table-wrap"><table>
            <thead><tr><th>Role</th><th>Page access</th><th>Function access</th>{user.isSuperAdmin && <th>Actions</th>}</tr></thead>
            <tbody>{data.roles.map(role => <tr key={role.id}><td><strong>{role.name}</strong></td><td>{role.is_super_admin ? "All" : role.permissions.filter(id => id in data.catalog.pages).length}</td><td>{role.is_super_admin ? "All" : role.permissions.filter(id => id in data.catalog.actions).length}</td>{user.isSuperAdmin && <td>{role.is_super_admin ? "Built-in role" : <button className="button small" onClick={() => setEditing(role)}>Edit</button>}</td>}</tr>)}</tbody>
          </table></div>}
        </section>
      </div>
    </>
  )
}

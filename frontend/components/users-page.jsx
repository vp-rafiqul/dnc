"use client"

import { useState } from "react"
import { Plus, UsersRound } from "lucide-react"
import { api } from "../lib/api"
import { useResource } from "./resource"
import { useSession } from "./session"
import { ErrorText, PageHeading } from "./shared"

function UserEditor({ account, roles, close, saved }) {
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    const fields = Object.fromEntries(new FormData(event.currentTarget))
    setBusy(true)
    setError("")
    try {
      await api(account.id ? `/admin/users/${account.id}` : "/admin/users", account.id
        ? { method: "PATCH", body: { roleId: fields.roleId, active: fields.active === "on" } }
        : { method: "POST", body: fields })
      await saved()
    } catch (error) { setError(error.message) }
    finally { setBusy(false) }
  }

  return (
    <section className="card stack">
      <h2>{account.id ? `Manage ${account.name}` : "New user"}</h2>
      <form className="stack" onSubmit={submit}>
        {!account.id && <div className="fields">
          <label>Name<input name="name" maxLength={80} required /></label>
          <label>Email<input name="email" type="email" maxLength={254} required /></label>
          <label>Initial password<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /><small>At least 12 characters</small></label>
        </div>}
        <label>Role<select name="roleId" defaultValue={account.role_id || ""} required><option value="" disabled>Select a role</option>{roles.map(role => <option value={role.id} key={role.id}>{role.name}</option>)}</select></label>
        {account.id && <label className="checkbox"><input type="checkbox" name="active" defaultChecked={account.active} /> Active account</label>}
        <ErrorText error={error} />
        <div className="button-row"><button className="button primary" disabled={busy || !roles.length}>{account.id ? "Save changes" : "Create user"}</button><button className="button" type="button" disabled={busy} onClick={close}>Cancel</button></div>
      </form>
    </section>
  )
}

export function UsersPage() {
  const { user } = useSession()
  const can = permission => user.permissions.includes(permission)
  const canList = can("users.list")
  const canCreate = can("users.create")
  const canEdit = can("users.update")
  const { data, pending, error, reload } = useResource(canList ? "/admin/users" : null)
  const { data: roles, error: rolesError } = useResource(canCreate || canEdit ? "/admin/users/assignable-roles" : null)
  const [editing, setEditing] = useState(null)

  return (
    <>
      <PageHeading title="Users" description="Create accounts, assign roles, and manage workspace access."
        action={canCreate && <button className="button primary" disabled={!roles?.length} onClick={() => setEditing({})}><Plus size={17} /> New user</button>} />
      <div className="stack">
        {roles?.length === 0 && <p className="notice">An assignable role is required to manage user accounts.</p>}
        <ErrorText error={rolesError} />
        {editing && <UserEditor key={editing.id || "new"} account={editing} roles={roles || []} close={() => setEditing(null)} saved={async () => { setEditing(null); await reload() }} />}
        <section className="card">
          <div className="card-heading"><span className="card-icon"><UsersRound size={18} /></span><div><h2>Workspace users</h2><p>Deactivating an account ends its sessions and revokes its API keys.</p></div></div>
          {!canList && <p className="notice">Your role does not include permission to list users.</p>}
          {pending && !data && <p role="status">Loading users…</p>}
          <ErrorText error={error} />
          {data && <div className="table-wrap"><table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th>{canEdit && <th>Actions</th>}</tr></thead>
            <tbody>{data.map(account => <tr key={account.id}><td><strong>{account.name}</strong></td><td>{account.email}</td><td>{account.role}</td><td><span className={`tag ${account.active ? "clear" : ""}`}>{account.active ? "Active" : "Inactive"}</span></td>{canEdit && <td>{account.manageable && <button className="button small" disabled={!roles?.length} onClick={() => setEditing(account)}>Manage</button>}</td>}</tr>)}</tbody>
          </table></div>}
        </section>
      </div>
    </>
  )
}

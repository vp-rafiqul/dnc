"use client"

import { useState } from "react"
import type { FormEvent } from "react"
import { Plus, UsersRound } from "lucide-react"
import { api, errorMessage } from "../lib/api"
import { useResource } from "./resource"
import { useWorkspaceUser } from "./session"
import { ErrorText, PageHeading } from "./shared"
import type { AssignableRole, Permission, WorkspaceUser } from "../../shared/contracts"

interface UserEditorProps {
  account: Partial<WorkspaceUser>
  roles: AssignableRole[]
  close: () => void
  saved: () => Promise<void>
}

function UserEditor({ account, roles, close, saved }: UserEditorProps) {
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = Object.fromEntries(new FormData(event.currentTarget))
    setBusy(true)
    setError("")
    try {
      if (account.id) {
        await api(`/admin/users/${account.id}`, {
          method: "PATCH", body: { roleId: account.is_reseller ? account.role_id : fields.roleId, active: fields.active === "on" },
        })
      } else {
        await api(account.is_reseller ? "/admin/resellers" : "/admin/users", { method: "POST", body: fields })
      }
      await saved()
    } catch (error) { setError(errorMessage(error)) }
    finally { setBusy(false) }
  }

  return (
    <section className="card stack">
      <h2>{account.id ? `Manage ${account.name}` : account.is_reseller ? "New reseller" : "New user"}</h2>
      <form className="stack" onSubmit={submit}>
        {!account.id && <div className="fields">
          <label>Name<input name="name" maxLength={80} required /></label>
          <label>Email<input name="email" type="email" maxLength={254} required /></label>
          <label>Initial password<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /><small>At least 12 characters</small></label>
        </div>}
        {!account.is_reseller && <label>Role<select name="roleId" defaultValue={account.role_id || ""} required><option value="" disabled>Select a role</option>{roles.map(role => <option value={role.id} key={role.id}>{role.name}</option>)}</select></label>}
        {account.id && <label className="checkbox"><input type="checkbox" name="active" defaultChecked={account.active} /> Active account</label>}
        <ErrorText error={error} />
        <div className="button-row"><button className="button primary" disabled={busy || (!account.is_reseller && !roles.length)}>{account.id ? "Save changes" : account.is_reseller ? "Create reseller" : "Create user"}</button><button className="button" type="button" disabled={busy} onClick={close}>Cancel</button></div>
      </form>
    </section>
  )
}

export function UsersPage() {
  const user = useWorkspaceUser()
  const can = (permission: Permission) => user.permissions.includes(permission)
  const canList = can("users.list")
  const canCreate = can("users.create")
  const canEdit = can("users.update")
  const { data, pending, error, reload } = useResource<WorkspaceUser[]>(canList ? "/admin/users" : null)
  const { data: roles, error: rolesError } = useResource<AssignableRole[]>(canCreate || canEdit ? "/admin/users/assignable-roles" : null)
  const [editing, setEditing] = useState<Partial<WorkspaceUser> | null>(null)
  const scope = user.isReseller ? user.id : null
  const newUserRoles = (roles || []).filter(role => role.reseller_id === scope)
  const editorRoles = editing?.id ? (roles || []).filter(role => role.reseller_id === editing.reseller_id) : newUserRoles

  return (
    <>
      <PageHeading title="Users" description={user.isReseller ? "Create users and assign roles in your reseller account." : "Create accounts, assign roles, and manage workspace access."}
        action={<div className="button-row">
          {user.isSuperAdmin && <button className="button" onClick={() => setEditing({ is_reseller: true })}><Plus size={17} /> New reseller</button>}
          {canCreate && <button className="button primary" disabled={!newUserRoles.length} onClick={() => setEditing({})}><Plus size={17} /> New user</button>}
        </div>} />
      <div className="stack">
        {canCreate && roles && !newUserRoles.length && <p className="notice">Create a role on the Roles page before adding a user.</p>}
        <ErrorText error={rolesError} />
        {editing && <UserEditor key={editing.id || (editing.is_reseller ? "new-reseller" : "new-user")} account={editing} roles={editorRoles} close={() => setEditing(null)} saved={async () => { setEditing(null); await reload() }} />}
        <section className="card">
          <div className="card-heading"><span className="card-icon"><UsersRound size={18} /></span><div><h2>Workspace users</h2><p>Deactivating an account ends its sessions and revokes its API keys.</p></div></div>
          {!canList && <p className="notice">Your role does not include permission to list users.</p>}
          {pending && !data && <p role="status">Loading users…</p>}
          <ErrorText error={error} />
          {data && <div className="table-wrap"><table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th>{user.isSuperAdmin && <th>Reseller</th>}<th>Status</th>{canEdit && <th>Actions</th>}</tr></thead>
            <tbody>{data.map(account => <tr key={account.id}><td><strong>{account.name}</strong></td><td>{account.email}</td><td>{account.role}</td>{user.isSuperAdmin && <td>{account.reseller || "—"}</td>}<td><span className={`tag ${account.active ? "clear" : ""}`}>{account.active ? "Active" : "Inactive"}</span></td>{canEdit && <td>{account.manageable && <button className="button small" disabled={!account.is_reseller && !roles?.length} onClick={() => setEditing(account)}>Manage</button>}</td>}</tr>)}</tbody>
          </table></div>}
        </section>
      </div>
    </>
  )
}

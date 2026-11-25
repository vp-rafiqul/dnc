export const permissions = {
  pages: {
    "page.screening": "Screening",
    "page.history": "History",
    "page.keys": "API keys",
    "page.users": "Users",
    "page.roles": "Roles",
    "page.seller": "Seller profile",
    "page.seller_review": "Seller verification",
    "page.billing": "Billing",
  },
  actions: {
    "screening.check": "Check a number in the workspace",
    "screening.api": "Check a number through the API",
    "history.read": "Read own screening history",
    "keys.list": "List own API keys",
    "keys.create": "Create own API keys",
    "keys.reveal": "Copy own API keys",
    "keys.update_rate_limit": "Customize rate limits on own API keys",
    "keys.revoke": "Revoke own API keys",
    "users.list": "List users",
    "users.create": "Create users",
    "users.update": "Assign roles and manage account status",
    "roles.list": "View roles and permissions",
    "seller.manage": "Manage own seller profile and authorization",
    "sellers.review": "Verify sellers and reveal SANs",
    "billing.manage": "Manage coverage catalog, prices and payments",
  },
} as const

export type Permission = keyof typeof permissions.pages | keyof typeof permissions.actions
export const permissionIds = Object.values(permissions).flatMap(group => Object.keys(group)) as Permission[]
const knownPermissions = new Set<string>(permissionIds)
export const isPermission = (id: string): id is Permission => knownPermissions.has(id)

const resellerManagement: Permission[] = ["page.users", "page.roles", "users.list", "users.create", "users.update", "roles.list"]
const resellerPages: Permission[] = ["page.screening", "page.history", "page.keys", "page.seller"]
const resellerActions = ["screening.", "history.", "keys.", "seller."]
export const resellerAssignablePermissions = permissionIds.filter(id =>
  resellerPages.includes(id) || resellerActions.some(prefix => id.startsWith(prefix)))
export const resellerPermissions = [...resellerAssignablePermissions, ...resellerManagement]

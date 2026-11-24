import type { Permission } from "../backend/src/permissions.ts"

export type { Permission }

export interface Principal {
  id: string
  name: string
  email: string
  role: string
  isSuperAdmin: boolean
  isReseller: boolean
  permissions: Permission[]
}

export interface Credentials {
  email: string
  password: string
}

export interface SessionPayload {
  user: Principal
  accessToken: string
  tokenType: "Bearer"
}

export interface AssignableRole {
  id: string
  name: string
  reseller_id: string | null
}

export interface Role extends AssignableRole {
  permissions: Permission[]
  is_super_admin: boolean
  is_reseller: boolean
  reseller: string | null
}

export type PermissionCatalog = Record<"pages" | "actions", Partial<Record<Permission, string>>>

export interface RoleCatalog {
  catalog: PermissionCatalog
  resellerCatalog: PermissionCatalog
  roles: Role[]
}

export interface WorkspaceUser {
  id: string
  name: string
  email: string
  role: string
  role_id: string
  reseller_id: string | null
  reseller: string | null
  is_super_admin: boolean
  is_reseller: boolean
  active: boolean
  manageable: boolean
}

export interface ApiKey<Timestamp = string> {
  id: string
  name: string
  prefix: string
  created_at: Timestamp
  revoked_at: Timestamp | null
  rate_limit_per_minute: number
  can_reveal: boolean
}

export interface IssuedApiKey extends ApiKey {
  secret: string
}

export type Channel = "web" | "api"

export interface ScreeningResult {
  phone: string
  exists: boolean
  federalMatch: boolean
  stateMatches: string[]
  source: "synthetic"
  generation: string
  publishedAt: string
  checkedAt: string
}

export interface HistoryFilters {
  from?: string
  until?: string
  channel?: Channel
  phone?: string
}

export interface HistoryItem<Timestamp = string> {
  id: string
  generation_id: string
  masked_phone: string
  exists_in_registry: boolean
  channel: Channel
  checked_at: Timestamp
}

export interface HistoryPageData {
  items: HistoryItem[]
  total: number
  page: number
  pageSize: number
}

export type HistoryReportFormat = "csv" | "xlsx" | "pdf"

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

export type SellerSubscriptionStatus = "AWAITING_PAYMENT" | "PENDING" | "VERIFIED" | "REJECTED" | "REVIEW_REQUIRED" | "EXPIRED" | "CANCELLED"
export type AuthorizationScope = "registry_access" | "number_screening"
export type RevocationChannel = "in_app" | "email"
export type EvidenceCheck = "confirmed" | "mismatch" | "unclear"

export interface SellerRepresentative {
  name: string
  title: string
  email: string
  phone: string
}

export interface SellerProfileInput {
  legalName: string
  organizationId: string
  /** Omit on update to keep the stored SAN. */
  san?: string
  representative: SellerRepresentative
}

export interface SellerProfile {
  id: string
  legal_name: string
  organization_id: string
  masked_san: string
  representative: SellerRepresentative
  created_at: string
  updated_at: string
}

export interface SellerAuthorizationRecord {
  id: string
  signer_name: string
  signer_title: string
  signer_email: string
  signed_at: string
  permitted_scope: AuthorizationScope[]
  expires_at: string
  revocation_channel: RevocationChannel
  revocation_contact: string | null
  revoked_at: string | null
  revocation_reason: string | null
  active: boolean
  evidence?: Record<string, unknown>
}

export interface SellerAuthorizationInput {
  signerName: string
  signerTitle: string
  signerEmail: string
  permittedScope: AuthorizationScope[]
  expiresOn: string
  revocationChannel: RevocationChannel
  revocationContact?: string
  consentTextVersion: string
  /** The API accepts only true. */
  electronicSignatureConsent: boolean
}

export interface SellerCoverageRecord {
  subscription_id: string
  area_code: string
  valid_from: string
  valid_until: string
  ended_at: string | null
  end_reason: string | null
  active: boolean
}

export interface SellerSubscriptionRecord {
  id: string
  status: SellerSubscriptionStatus
  requested_area_codes: string[]
  status_reason: string | null
  period_start: string | null
  period_end: string | null
  verified_at: string | null
  next_review_at: string | null
  created_at: string
  coverage_scope: CoverageScope | null
  selected_states: string[]
  billing_cycle: BillingCycle | null
  amount_cents: number | null
  currency: string | null
  paid_at: string | null
  /** Set when the subscription is first verified: the billing period starts with coverage. */
  paid_through: string | null
  payments: PaymentRecord[]
}

export interface SellerNoticeRecord {
  id: string
  subscription_id: string | null
  kind: "RENEWAL" | "REVIEW_DUE" | "EXPIRED" | "AUTHORIZATION_EXPIRING"
  message: string
  due_at: string
  delivered_at: string | null
}

export interface ConsentText {
  version: string
  text: string
}

export interface SellerOverview {
  profile: SellerProfile | null
  authorization: SellerAuthorizationRecord | null
  subscriptions: SellerSubscriptionRecord[]
  coverage: SellerCoverageRecord[]
  notices: SellerNoticeRecord[]
  consent: ConsentText
  scopes: Record<AuthorizationScope, string>
}

export interface SellerReviewSummary {
  id: string
  legal_name: string
  organization_id: string
  masked_san: string
  owner_email: string
  status: SellerSubscriptionStatus | null
  subscription_id: string | null
  review_due: boolean
  authorization_active: boolean
  updated_at: string
}

export interface SellerVerificationRecord {
  id: string
  subscription_id: string
  outcome: Exclude<SellerSubscriptionStatus, "PENDING" | "EXPIRED">
  reviewer_name: string
  reviewer_email: string
  san_period_start: string | null
  san_period_end: string | null
  confirmed_area_codes: string[]
  evidence: Record<string, unknown>
  reasons: string[]
  created_at: string
}

export interface SellerEventRecord {
  id: string
  action: string
  actor: string | null
  detail: Record<string, unknown>
  created_at: string
}

export interface SellerReviewDetail {
  profile: SellerProfile
  owner: { name: string; email: string }
  authorizations: SellerAuthorizationRecord[]
  subscriptions: SellerSubscriptionRecord[]
  verifications: SellerVerificationRecord[]
  coverage: SellerCoverageRecord[]
  notices: SellerNoticeRecord[]
  events: SellerEventRecord[]
}

export interface SellerVerificationInput {
  decision: "verify" | "reject"
  /** Reviewer confirms they checked the seller with the FTC; makes ftcReference optional. */
  attested?: boolean
  ftcReference?: string
  checkedOn?: string
  identity: EvidenceCheck
  sanPeriod: EvidenceCheck
  areaCodes: EvidenceCheck
  sanPeriodStart?: string
  sanPeriodEnd?: string
  confirmedAreaCodes?: string[]
  evidenceLocation?: string
  notes?: string
}

export interface SellerVerificationResult {
  outcome: SellerVerificationRecord["outcome"]
  reasons: string[]
}

export type CoverageScope = "national" | "states" | "area_codes"
export type BillingCycle = "monthly" | "yearly"
export type PaymentMethod = "card" | "bank_transfer"
export type PaymentStatus = "PENDING" | "PAID" | "FAILED" | "CANCELLED"

export interface RegistrationInput {
  name: string
  email: string
  password: string
}

export interface PaymentRecord {
  id: string
  subscription_id: string
  method: PaymentMethod
  status: PaymentStatus
  amount_cents: number
  currency: string
  reference: string
  checkout_url: string | null
  created_at: string
  confirmed_at: string | null
}

export interface SellerCatalogAreaCode {
  area_code: string
  monthly_cents: number
  yearly_cents: number
}

export interface SellerCatalog {
  states: { code: string; name: string; area_codes: SellerCatalogAreaCode[] }[]
  currency: string
  card_enabled: boolean
  bank_instructions: string
}

export interface SellerPurchaseInput {
  scope: CoverageScope
  states?: string[]
  areaCodes?: string[]
  cycle: BillingCycle
  method: PaymentMethod
}

export interface SellerPurchaseResult {
  subscription_id: string
  amount_cents: number
  currency: string
  payment: PaymentRecord
  checkout_url: string | null
  /** Set for embedded card checkout: mount it in the app with Stripe.js. */
  client_secret: string | null
  publishable_key: string | null
  bank_instructions: string | null
}

export interface BillingSettingsRecord {
  monthly_price_cents: number
  yearly_price_cents: number
  currency: string
  bank_instructions: string
  updated_at: string
}

export interface AdminCatalogAreaCode {
  area_code: string
  state_code: string
  active: boolean
  monthly_price_cents: number | null
  yearly_price_cents: number | null
}

export interface AdminCatalog {
  settings: BillingSettingsRecord
  states: { code: string; name: string; active: boolean; area_codes: AdminCatalogAreaCode[] }[]
  card_enabled: boolean
}

export interface AdminPaymentRecord extends PaymentRecord {
  seller_id: string
  legal_name: string
  owner_email: string
  billing_cycle: BillingCycle | null
  coverage_scope: CoverageScope | null
  selected_states: string[]
  area_code_count: number
  confirmed_by: string | null
  details: Record<string, unknown>
}

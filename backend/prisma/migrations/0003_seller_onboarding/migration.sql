BEGIN;

CREATE TABLE sellers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL UNIQUE REFERENCES users(id),
  legal_name text NOT NULL,
  organization_id text NOT NULL,
  san_ciphertext bytea NOT NULL,
  san_key_id text NOT NULL,
  san_last4 text NOT NULL,
  representative_name text NOT NULL,
  representative_title text NOT NULL,
  representative_email text NOT NULL,
  representative_phone text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE seller_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES sellers(id),
  signer_name text NOT NULL,
  signer_title text NOT NULL,
  signer_email text NOT NULL,
  signed_by uuid NOT NULL REFERENCES users(id),
  signed_at timestamptz NOT NULL DEFAULT now(),
  permitted_scope text[] NOT NULL CHECK (cardinality(permitted_scope) > 0),
  expires_at timestamptz NOT NULL,
  revocation_channel text NOT NULL CHECK (revocation_channel IN ('in_app', 'email')),
  revocation_contact text,
  evidence jsonb NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users(id),
  revocation_reason text,
  CHECK (expires_at > signed_at),
  CHECK (revocation_channel <> 'email' OR revocation_contact IS NOT NULL)
);
CREATE UNIQUE INDEX seller_single_active_authorization ON seller_authorizations (seller_id) WHERE revoked_at IS NULL;

CREATE TABLE seller_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES sellers(id),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'VERIFIED', 'REJECTED', 'REVIEW_REQUIRED', 'EXPIRED')),
  requested_area_codes text[] NOT NULL DEFAULT '{}',
  status_reason text,
  period_start timestamptz,
  period_end timestamptz,
  verified_at timestamptz,
  verified_by uuid REFERENCES users(id),
  next_review_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'VERIFIED' OR (
    period_start IS NOT NULL AND period_end > period_start AND verified_at IS NOT NULL AND verified_by IS NOT NULL
  ))
);
CREATE INDEX seller_subscriptions_seller ON seller_subscriptions (seller_id, created_at DESC);
CREATE INDEX seller_subscriptions_verified_end ON seller_subscriptions (period_end) WHERE status = 'VERIFIED';

CREATE TABLE seller_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES seller_subscriptions(id),
  authorization_id uuid REFERENCES seller_authorizations(id),
  reviewer_id uuid NOT NULL REFERENCES users(id),
  reviewer_name text NOT NULL,
  reviewer_email text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('VERIFIED', 'REJECTED', 'REVIEW_REQUIRED')),
  san_period_start timestamptz,
  san_period_end timestamptz,
  confirmed_area_codes text[] NOT NULL DEFAULT '{}',
  evidence jsonb NOT NULL,
  reasons text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX seller_verifications_subscription ON seller_verifications (subscription_id, created_at DESC);

CREATE TABLE seller_coverage (
  subscription_id uuid NOT NULL REFERENCES seller_subscriptions(id),
  area_code text NOT NULL CHECK (area_code ~ '^[2-9][0-8][0-9]$'),
  verification_id uuid NOT NULL REFERENCES seller_verifications(id),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  ended_at timestamptz,
  end_reason text,
  PRIMARY KEY (subscription_id, area_code),
  CHECK (valid_until > valid_from)
);
CREATE INDEX seller_coverage_open ON seller_coverage (valid_until) WHERE ended_at IS NULL;

CREATE TABLE seller_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES sellers(id),
  subscription_id uuid REFERENCES seller_subscriptions(id),
  kind text NOT NULL CHECK (kind IN ('RENEWAL', 'REVIEW_DUE', 'EXPIRED', 'AUTHORIZATION_EXPIRING')),
  audience text NOT NULL CHECK (audience IN ('seller', 'reviewer')),
  message text NOT NULL,
  due_at timestamptz NOT NULL,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX seller_notices_due ON seller_notices (due_at) WHERE delivered_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX seller_notices_seller ON seller_notices (seller_id, due_at DESC);

CREATE TABLE seller_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES sellers(id),
  actor_id uuid REFERENCES users(id),
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX seller_events_recent ON seller_events (seller_id, created_at DESC);

COMMIT;

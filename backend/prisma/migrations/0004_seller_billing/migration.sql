BEGIN;

-- Self-registered sellers receive this role.
ALTER TABLE roles ADD COLUMN is_self_service boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX single_self_service_role ON roles (is_self_service) WHERE is_self_service;

-- Admin-managed coverage catalog.
CREATE TABLE coverage_states (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z]{2}$'),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE coverage_area_codes (
  area_code text PRIMARY KEY CHECK (area_code ~ '^[2-9][0-8][0-9]$' AND area_code !~ '11$'),
  state_code text NOT NULL REFERENCES coverage_states(code),
  active boolean NOT NULL DEFAULT true,
  monthly_price_cents integer CHECK (monthly_price_cents >= 0),
  yearly_price_cents integer CHECK (yearly_price_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX coverage_area_codes_state ON coverage_area_codes (state_code);

CREATE TABLE billing_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  monthly_price_cents integer NOT NULL DEFAULT 500 CHECK (monthly_price_cents >= 0),
  yearly_price_cents integer NOT NULL DEFAULT 6000 CHECK (yearly_price_cents >= 0),
  currency text NOT NULL DEFAULT 'usd' CHECK (currency ~ '^[a-z]{3}$'),
  bank_instructions text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id)
);
INSERT INTO billing_settings (id) VALUES (1);

-- Subscriptions are chosen and paid for before they reach verification.
ALTER TABLE seller_subscriptions DROP CONSTRAINT seller_subscriptions_status_check;
ALTER TABLE seller_subscriptions
  ADD CONSTRAINT seller_subscriptions_status_check CHECK (status IN (
    'AWAITING_PAYMENT', 'PENDING', 'VERIFIED', 'REJECTED', 'REVIEW_REQUIRED', 'EXPIRED', 'CANCELLED'
  )),
  ALTER COLUMN status SET DEFAULT 'AWAITING_PAYMENT',
  ADD COLUMN coverage_scope text CHECK (coverage_scope IN ('national', 'states', 'area_codes')),
  ADD COLUMN selected_states text[] NOT NULL DEFAULT '{}',
  ADD COLUMN billing_cycle text CHECK (billing_cycle IN ('monthly', 'yearly')),
  ADD COLUMN amount_cents integer CHECK (amount_cents >= 0),
  ADD COLUMN currency text,
  ADD COLUMN quote jsonb,
  ADD COLUMN paid_at timestamptz,
  ADD COLUMN paid_through timestamptz;

CREATE TABLE seller_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES seller_subscriptions(id),
  seller_id uuid NOT NULL REFERENCES sellers(id),
  method text NOT NULL CHECK (method IN ('card', 'bank_transfer')),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID', 'FAILED', 'CANCELLED')),
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL,
  reference text NOT NULL UNIQUE,
  stripe_session_id text UNIQUE,
  stripe_payment_intent text,
  checkout_url text,
  confirmed_by uuid REFERENCES users(id),
  confirmed_at timestamptz,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX seller_payments_subscription ON seller_payments (subscription_id, created_at DESC);
CREATE INDEX seller_payments_open ON seller_payments (created_at) WHERE status = 'PENDING';
CREATE UNIQUE INDEX seller_single_pending_payment ON seller_payments (subscription_id) WHERE status = 'PENDING';

COMMIT;

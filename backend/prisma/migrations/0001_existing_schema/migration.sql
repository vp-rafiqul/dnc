BEGIN;

-- 001_initial
CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  permissions text[] NOT NULL DEFAULT '{}',
  is_super_admin boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX IF NOT EXISTS role_name_unique ON roles (lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS single_super_admin_role ON roles (is_super_admin) WHERE is_super_admin;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role_id uuid NOT NULL REFERENCES roles(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL,
  prefix text NOT NULL,
  secret_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS registry_generations (
  id text PRIMARY KEY,
  published_at timestamptz NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX IF NOT EXISTS single_active_generation ON registry_generations (active) WHERE active;

CREATE TABLE IF NOT EXISTS registry_numbers (
  generation_id text NOT NULL REFERENCES registry_generations(id),
  phone text NOT NULL CHECK (phone ~ '^[2-9][0-9]{2}55501[0-9]{2}$'),
  jurisdiction text NOT NULL CHECK (jurisdiction = 'FEDERAL' OR jurisdiction ~ '^[A-Z]{2}$'),
  PRIMARY KEY (generation_id, phone, jurisdiction)
);

CREATE TABLE IF NOT EXISTS screening_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  generation_id text NOT NULL REFERENCES registry_generations(id),
  masked_phone text NOT NULL,
  exists_in_registry boolean NOT NULL,
  channel text NOT NULL CHECK (channel IN ('web', 'api')),
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS screening_recent ON screening_events (user_id, checked_at DESC, id DESC);

-- 002_api_key_rate_limit
ALTER TABLE api_keys
  ADD COLUMN rate_limit_per_minute integer NOT NULL DEFAULT 60 CHECK (rate_limit_per_minute > 0),
  ADD COLUMN rate_window_start timestamptz,
  ADD COLUMN rate_request_count integer NOT NULL DEFAULT 0 CHECK (rate_request_count >= 0);

-- 003_api_key_secret
ALTER TABLE api_keys
  ADD COLUMN encrypted_secret bytea,
  ADD CONSTRAINT api_keys_revoked_secret_check CHECK (revoked_at IS NULL OR encrypted_secret IS NULL);

-- 004_screening_history_search
ALTER TABLE screening_events ADD COLUMN phone_search_tokens text[];

-- 005_reseller_access
ALTER TABLE roles
  ADD COLUMN is_reseller boolean NOT NULL DEFAULT false,
  ADD COLUMN reseller_id uuid REFERENCES users(id),
  ADD CONSTRAINT roles_reseller_scope_check CHECK (
    NOT (is_super_admin AND is_reseller)
    AND (reseller_id IS NULL OR (NOT is_super_admin AND NOT is_reseller))
  );

DROP INDEX role_name_unique;
CREATE UNIQUE INDEX global_role_name_unique ON roles (lower(name))
  WHERE reseller_id IS NULL AND NOT is_reseller;
CREATE UNIQUE INDEX reseller_role_name_unique ON roles (reseller_id, lower(name))
  WHERE reseller_id IS NOT NULL;
CREATE UNIQUE INDEX single_reseller_role ON roles (is_reseller) WHERE is_reseller;

INSERT INTO roles (name, is_reseller) VALUES ('Reseller', true);

-- Retain the previous migration ledger for databases upgraded in place.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;

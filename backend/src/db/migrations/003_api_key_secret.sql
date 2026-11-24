ALTER TABLE api_keys
  ADD COLUMN encrypted_secret bytea,
  ADD CONSTRAINT api_keys_revoked_secret_check CHECK (revoked_at IS NULL OR encrypted_secret IS NULL);

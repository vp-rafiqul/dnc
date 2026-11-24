ALTER TABLE api_keys
  ADD COLUMN rate_limit_per_minute integer NOT NULL DEFAULT 60 CHECK (rate_limit_per_minute > 0),
  ADD COLUMN rate_window_start timestamptz,
  ADD COLUMN rate_request_count integer NOT NULL DEFAULT 0 CHECK (rate_request_count >= 0);

BEGIN;
ALTER TABLE screening_events ADD COLUMN legacy_phone_suffix text;
UPDATE screening_events
SET phone_search_tokens = '{}', legacy_phone_suffix = right(masked_phone, 4)
WHERE phone_search_tokens IS NULL;
ALTER TABLE screening_events
  ALTER COLUMN phone_search_tokens SET DEFAULT '{}',
  ALTER COLUMN phone_search_tokens SET NOT NULL;
COMMIT;

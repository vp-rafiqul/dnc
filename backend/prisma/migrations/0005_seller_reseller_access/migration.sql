BEGIN;
-- Set while a self-registered seller holds the built-in Reseller role because of an active verified subscription.
-- Only accounts promoted this way are moved back when verification lapses.
ALTER TABLE sellers ADD COLUMN reseller_access boolean NOT NULL DEFAULT false;
COMMIT;

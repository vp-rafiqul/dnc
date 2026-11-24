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

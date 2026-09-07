-- The instance sends from its own connection instead of a bought address.
-- Off by default, because an account acting from a datacentre is an account at risk.
ALTER TABLE instance_settings ADD COLUMN direct_egress INTEGER NOT NULL DEFAULT 0;

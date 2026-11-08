-- MatMove client privilege reduction (applied to MatMove.Ent on 2026-11-08)
--
-- Customer and Admin app clients do not need table-level TRUNCATE, TRIGGER or
-- REFERENCES privileges. These privileges are not needed to execute existing
-- row triggers, read rows, or perform RLS-controlled DML.
--
-- Existing SELECT/INSERT/UPDATE/DELETE grants and all RLS policies are left
-- unchanged by this migration. Server-side service_role behavior is unchanged.

REVOKE REFERENCES, TRIGGER, TRUNCATE
ON ALL TABLES IN SCHEMA public
FROM anon, authenticated;

-- Restrict defaults for future public tables created as the postgres role.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
REVOKE REFERENCES, TRIGGER, TRUNCATE
ON TABLES
FROM anon, authenticated;

-- Note: the Supabase-managed supabase_admin role has separate default ACLs.
-- Supabase denied ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin from the
-- connected SQL migration context, so those defaults were not modified here.
-- Existing table grants for anon/authenticated were verified to contain none
-- of these three privileges after the first statement.

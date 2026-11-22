# Supabase migration history

The files in `supabase/migrations` were restored from the SQL statements recorded in the active MatMove.Ent production project's `supabase_migrations.schema_migrations` table on 2026-11-22.

The active production migration history contains 124 applied versions. These filenames deliberately use the exact remote version and name; do not rename them or mark them reverted. This restores the repository source of truth and prevents a future `supabase db push` from replaying stale duplicate files.

The separate file in `docs/pending-migrations` is not recorded as applied in production. It is a proposed customer passcode policy change and must only be moved into the active migration directory with a new migration version after its dedicated tests and production rollout are approved.

Do not reset or repair production migration history as part of this reconciliation. No production SQL is executed by this repository change.

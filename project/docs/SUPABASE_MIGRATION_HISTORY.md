# Supabase migration history

The files in `supabase/migrations` are the source of truth for the active MatMove.Ent production project's applied migration history.

On 2026-11-22, the repository's stale 51-file migration directory was reconciled against the SQL statements retained in `supabase_migrations.schema_migrations`. All 124 previously applied migrations were restored with their exact production version and name; no historical migration was replayed and no migration history was reset.

After that reconciliation, the public homepage view security migration `20261122223335_matmove_public_homepage_posts_security_invoker_v1.sql` was applied through Supabase migration tooling and verified in production. The repository now contains that exact canonical migration file as well.

The current production migration history contains 125 applied versions. The unrelated six-to-nine-digit passcode policy change remains under `docs/pending-migrations` and is not marked as applied; it must be reviewed and deployed separately.

Do not reset or repair production migration history. New DDL must be added as a new migration and applied through the Supabase migration workflow.

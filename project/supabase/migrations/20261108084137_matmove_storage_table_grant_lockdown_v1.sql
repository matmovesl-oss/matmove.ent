
-- MatMove security lockdown phase 8: reduce Storage table-level grants.
-- Row-level policies continue to control authenticated object operations.

revoke insert, update, delete on table storage.objects from public, anon;
grant select on table storage.objects to anon, authenticated;
grant insert, update, delete on table storage.objects to authenticated;
grant all on table storage.objects to service_role;

-- Bucket configuration must never be changed from browser sessions.
revoke insert, update, delete on table storage.buckets from public, anon, authenticated;
grant select on table storage.buckets to anon, authenticated;
grant all on table storage.buckets to service_role;

notify pgrst, 'reload schema';

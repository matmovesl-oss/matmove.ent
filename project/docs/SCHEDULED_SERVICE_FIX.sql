-- SUPABASE SQL EDITOR: adds scheduled to the audited service allowlist.
-- Existing ride, delivery, truck and bus records remain valid. No bookings are changed.
begin;
do $preflight$
declare current_rule text;expected_rule text;
begin
 if to_regclass('public.bookings') is null then raise exception 'STOP: Bookings table is missing.';end if;
 select pg_get_constraintdef(oid) into current_rule from pg_constraint
 where conrelid='public.bookings'::regclass and conname='bookings_service_type_check';
 expected_rule := 'CHECK ((service_type = ANY (ARRAY[''ride''::text, ''delivery''::text, ''truck''::text, ''bus''::text])))';
 if current_rule is distinct from expected_rule
 and current_rule is distinct from 'CHECK ((service_type = ANY (ARRAY[''ride''::text, ''delivery''::text, ''truck''::text, ''bus''::text, ''scheduled''::text])))' then
  raise exception 'STOP: Service rule differs from the reviewed production rule. No changes made.';
 end if;
end $preflight$;
alter table public.bookings drop constraint bookings_service_type_check;
alter table public.bookings add constraint bookings_service_type_check
 check(service_type in ('ride','delivery','truck','bus','scheduled'));
notify pgrst,'reload schema';
commit;
select exists(select 1 from pg_constraint where conrelid='public.bookings'::regclass
 and conname='bookings_service_type_check' and pg_get_constraintdef(oid) like '%''scheduled''%')
 as scheduled_service_ready;

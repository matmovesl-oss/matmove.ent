-- Records future trip transitions only. Does not invent old trip times.
begin;
alter table public.bookings add column if not exists accepted_at timestamptz;
alter table public.bookings add column if not exists started_at timestamptz;
alter table public.bookings add column if not exists completed_at timestamptz;
create or replace function public.matmove_record_trip_timeline()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $fn$
begin
 if tg_op='INSERT' then
  new.accepted_at:=null;new.started_at:=null;new.completed_at:=null;
 else
  new.accepted_at:=old.accepted_at;new.started_at:=old.started_at;new.completed_at:=old.completed_at;
  if new.status::text='accepted' and old.status::text in ('pending','pending_admin') and old.accepted_at is null then new.accepted_at:=clock_timestamp();end if;
  if new.status::text='in_progress' and old.status::text='accepted' and old.started_at is null then new.started_at:=clock_timestamp();end if;
  if new.status::text='completed' and old.status::text='in_progress' and old.completed_at is null then new.completed_at:=clock_timestamp();end if;
 end if;
 return new;
end;
$fn$;
drop trigger if exists matmove_record_trip_timeline on public.bookings;
create trigger matmove_record_trip_timeline before insert or update on public.bookings for each row execute function public.matmove_record_trip_timeline();
revoke all on function public.matmove_record_trip_timeline() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
select exists(select 1 from pg_trigger where tgrelid='public.bookings'::regclass and tgname='matmove_record_trip_timeline' and not tgisinternal) as future_trip_times_ready;

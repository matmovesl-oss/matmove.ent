
begin;

-- Keep scheduled posts visible as "Coming soon"; continue to exclude drafts,
-- archived posts and posts that have already expired.
create or replace view public.matmove_public_homepage_posts
with (security_barrier = true)
as
select
  id,
  title,
  summary,
  body,
  image_path,
  starts_at,
  expires_at,
  display_order,
  price_amount,
  price_currency,
  created_at,
  (starts_at is not null and starts_at > now()) as is_scheduled
from public.matmove_homepage_posts
where status = 'published'
  and deleted_at is null
  and (expires_at is null or expires_at > now());

revoke all on public.matmove_public_homepage_posts from public;
grant usage on schema public to anon;
grant select on public.matmove_public_homepage_posts to anon, authenticated;

-- Realtime exposes only a monotonically increasing refresh signal, never post content.
create table if not exists public.matmove_homepage_post_feed_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default clock_timestamp()
);
alter table public.matmove_homepage_post_feed_events enable row level security;
revoke all on public.matmove_homepage_post_feed_events from public, anon, authenticated;
grant select on public.matmove_homepage_post_feed_events to anon, authenticated;
drop policy if exists matmove_homepage_post_feed_events_public_read on public.matmove_homepage_post_feed_events;
create policy matmove_homepage_post_feed_events_public_read
  on public.matmove_homepage_post_feed_events
  for select to anon, authenticated
  using (true);

create or replace function public.matmove_homepage_post_feed_emit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  insert into public.matmove_homepage_post_feed_events default values;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;
revoke all on function public.matmove_homepage_post_feed_emit() from public, anon, authenticated;

drop trigger if exists matmove_homepage_post_feed_emit on public.matmove_homepage_posts;
create trigger matmove_homepage_post_feed_emit
after insert or update or delete on public.matmove_homepage_posts
for each row execute function public.matmove_homepage_post_feed_emit();

do $publication$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
    and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='matmove_homepage_post_feed_events') then
    alter publication supabase_realtime add table public.matmove_homepage_post_feed_events;
  end if;
end;
$publication$;

notify pgrst,'reload schema';
commit;

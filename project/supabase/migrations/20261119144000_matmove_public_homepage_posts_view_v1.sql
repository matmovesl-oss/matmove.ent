begin;

-- Public landing-page feed: expose published content only, not admin audit fields.
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
  created_at
from public.matmove_homepage_posts
where status = 'published'
  and deleted_at is null
  and (starts_at is null or starts_at <= now())
  and (expires_at is null or expires_at > now());

revoke all on public.matmove_public_homepage_posts from public;
grant usage on schema public to anon;
grant select on public.matmove_public_homepage_posts to anon, authenticated;

comment on view public.matmove_public_homepage_posts is
  'Read-only public feed of currently published MatMove homepage posts. Excludes administrative ownership and audit columns.';

commit;

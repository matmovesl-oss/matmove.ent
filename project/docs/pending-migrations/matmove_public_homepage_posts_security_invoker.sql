begin;

-- Let the public landing feed use caller privileges and base-table RLS.
-- The anonymous role receives only public content and the two filter columns.
grant select (
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
  status,
  deleted_at
) on public.matmove_homepage_posts to anon;

drop policy if exists matmove_homepage_posts_anon_public_feed_read
  on public.matmove_homepage_posts;

create policy matmove_homepage_posts_anon_public_feed_read
  on public.matmove_homepage_posts
  for select
  to anon
  using (
    status = 'published'
    and deleted_at is null
    and (expires_at is null or expires_at > now())
  );

alter view public.matmove_public_homepage_posts
  set (security_invoker = true, security_barrier = true);

notify pgrst, 'reload schema';

commit;

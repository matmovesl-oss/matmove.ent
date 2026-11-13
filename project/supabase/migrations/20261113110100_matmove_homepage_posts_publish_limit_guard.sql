-- Serialize all concurrent publication changes so the three-post cap is a
-- database invariant even when two Admin users publish at the same time.
create or replace function public.matmove_homepage_enforce_three_published()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $function$
declare n integer;
begin
 if new.status='published' and new.deleted_at is null and (new.expires_at is null or new.expires_at>clock_timestamp()) then
  perform pg_advisory_xact_lock(hashtextextended('matmove-homepage-publish-slot',0));
  select count(*) into n from public.matmove_homepage_posts p
   where p.id<>new.id and p.status='published' and p.deleted_at is null
     and (p.expires_at is null or p.expires_at>clock_timestamp());
  if n>=3 then raise exception 'INVALID: No more than three homepage posts may be published at once.'; end if;
 end if;
 return new;
end;$function$;
drop trigger if exists matmove_homepage_posts_three_published on public.matmove_homepage_posts;
create trigger matmove_homepage_posts_three_published
before insert or update of status,expires_at,deleted_at on public.matmove_homepage_posts
for each row execute function public.matmove_homepage_enforce_three_published();

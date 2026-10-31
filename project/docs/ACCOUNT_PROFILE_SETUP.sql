
-- CUSTOMER: run this COMPLETE file once in the shared Supabase SQL Editor.
-- Profile presentation only. Verified identity, roles, KYC and wallets are unchanged.
begin;
do $requirements$
begin
 if to_regprocedure('public.matmove_preferences_role(uuid)') is null then
  raise exception 'Run the complete PORTAL_HOME_SETUP.sql first.';
 end if;
end;
$requirements$;

create table if not exists public.matmove_account_presentation(
 user_id uuid primary key references auth.users(id) on delete cascade,
 display_name text check(display_name is null or length(btrim(display_name)) between 1 and 60),
 photo_path text,
 version bigint not null default 1 check(version>0),
 updated_at timestamptz not null default now()
);
alter table public.matmove_account_presentation enable row level security;
revoke all on public.matmove_account_presentation from public,anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('matmove-profile-photos','matmove-profile-photos',false,2097152,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists matmove_profile_photo_read on storage.objects;
create policy matmove_profile_photo_read on storage.objects for select to authenticated
using(bucket_id='matmove-profile-photos' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists matmove_profile_photo_insert on storage.objects;
create policy matmove_profile_photo_insert on storage.objects for insert to authenticated
with check(bucket_id='matmove-profile-photos' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists matmove_profile_photo_read_scope on storage.objects;
create policy matmove_profile_photo_read_scope on storage.objects as restrictive for select to authenticated
using(bucket_id<>'matmove-profile-photos' or (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists matmove_profile_photo_insert_scope on storage.objects;
create policy matmove_profile_photo_insert_scope on storage.objects as restrictive for insert to authenticated
with check(bucket_id<>'matmove-profile-photos' or (storage.foldername(name))[1]=auth.uid()::text);
-- Replacements use a unique new object; this screen cannot overwrite/delete photos.
drop policy if exists matmove_profile_photo_no_overwrite on storage.objects;
create policy matmove_profile_photo_no_overwrite on storage.objects as restrictive for update to authenticated
using(bucket_id<>'matmove-profile-photos') with check(bucket_id<>'matmove-profile-photos');
drop policy if exists matmove_profile_photo_no_delete on storage.objects;
create policy matmove_profile_photo_no_delete on storage.objects as restrictive for delete to authenticated
using(bucket_id<>'matmove-profile-photos');
drop policy if exists matmove_profile_photo_no_anonymous on storage.objects;
create policy matmove_profile_photo_no_anonymous on storage.objects as restrictive for all to anon
using(bucket_id<>'matmove-profile-photos') with check(bucket_id<>'matmove-profile-photos');

create or replace function public.matmove_account_presentation_me()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $me$
declare v public.matmove_account_presentation%rowtype;
begin
 perform public.matmove_preferences_role(auth.uid());
 select * into v from public.matmove_account_presentation where user_id=auth.uid();
 if not found then return jsonb_build_object('user_id',auth.uid(),'display_name',null,'photo_path',null,'version',0);end if;
 return to_jsonb(v);
end;
$me$;

create or replace function public.matmove_save_account_presentation(p_display_name text,p_photo_path text,p_expected bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $save$
declare v public.matmove_account_presentation%rowtype;v_name text:=nullif(btrim(p_display_name),'');
 v_path text:=nullif(btrim(p_photo_path),'');v_meta jsonb;v_version bigint;
begin
 perform public.matmove_preferences_role(auth.uid());
 -- The profile row serializes a first save too. No identity field is updated.
 perform 1 from public.profiles where id=auth.uid() for update;
 if p_expected is null or p_expected<0 or (v_name is not null and length(v_name)>60) then
  raise exception 'INVALID: Enter a display name of up to 60 characters.';
 end if;
 select * into v from public.matmove_account_presentation where user_id=auth.uid() for update;
 v_version:=case when found then v.version else 0 end;
 if p_expected<>v_version then raise exception 'CONFLICT: Your profile changed. Reload it before saving again.';end if;
 if v_path is not null then
  if v_path !~ ('^'||auth.uid()::text||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$') then
   raise exception 'INVALID: Choose a photo uploaded to your own account.';
  end if;
  select metadata into v_meta from storage.objects where bucket_id='matmove-profile-photos' and name=v_path;
  if not found or v_meta is null or coalesce(v_meta->>'mimetype','') not in ('image/jpeg','image/png','image/webp')
   or coalesce(v_meta->>'size','') !~ '^[0-9]+$' then raise exception 'INVALID: Photo upload has not been confirmed.';end if;
  if (v_meta->>'size')::numeric not between 1 and 2097152 then raise exception 'INVALID: Profile photo must be 2 MB or smaller.';end if;
 end if;
 insert into public.matmove_account_presentation(user_id,display_name,photo_path,version)
 values(auth.uid(),v_name,v_path,1)
 on conflict(user_id) do update set display_name=excluded.display_name,photo_path=excluded.photo_path,
  version=matmove_account_presentation.version+1,updated_at=now()
 returning * into v;
 return to_jsonb(v);
end;
$save$;
revoke all on function public.matmove_account_presentation_me() from public,anon;
revoke all on function public.matmove_save_account_presentation(text,text,bigint) from public,anon;
grant execute on function public.matmove_account_presentation_me() to authenticated;
grant execute on function public.matmove_save_account_presentation(text,text,bigint) to authenticated;
notify pgrst,'reload schema';
commit;

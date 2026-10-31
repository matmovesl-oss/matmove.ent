

-- MatMove Home preferences. Run the COMPLETE file in the shared Supabase SQL Editor.
-- Additive: no changes to KYC approval, payment accounts, fees, or payment APIs.
-- Card references are NOT saved payment methods; they cannot authorize a charge.
begin;

create table if not exists public.matmove_saved_places (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('home','work')),
  address text not null check (length(address) between 3 and 300),
  latitude double precision,
  longitude double precision,
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  primary key(user_id,kind),
  check ((latitude is null and longitude is null) or
    (latitude is not null and longitude is not null and
     latitude between -90 and 90 and longitude between -180 and 180))
);
create table if not exists public.matmove_card_references (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname text not null check (length(nickname) between 1 and 40 and nickname ~ '^[[:alpha:] .''-]+$'),
  brand text not null check (brand in ('Visa','Mastercard','American Express','Other')),
  last_four text not null check (last_four ~ '^[0-9]{4}$'),
  created_at timestamptz not null default now(),
  unique(user_id,brand,last_four)
);
alter table public.matmove_saved_places enable row level security;
alter table public.matmove_card_references enable row level security;
revoke all on public.matmove_saved_places, public.matmove_card_references from public,anon,authenticated;

create or replace function public.matmove_preferences_role(p_user_id uuid)
returns text language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare v_role text;
begin
  if auth.uid() is null or auth.uid() is distinct from p_user_id then raise exception 'AUTH: Sign in to continue.'; end if;
  select p.role::text into v_role from public.profiles p where p.id=auth.uid();
  -- Existing customer session setup permits legacy profiles without role rows.
  -- Reject conflicting/non-customer memberships; never grant or change a role here.
  if v_role is null or v_role not in ('rider','driver','merchant') or (
    exists(select 1 from public.user_roles r where r.profile_id=auth.uid()) and not exists(
      select 1 from public.user_roles r where r.profile_id=auth.uid() and r.role::text=v_role
    )
  ) or exists(select 1 from public.user_roles r where r.profile_id=auth.uid() and r.role::text not in ('rider','driver','merchant')) then
    raise exception 'ACCESS: Customer account setup required.';
  end if;
  return v_role;
end;
$fn$;

create or replace function public.matmove_home_preferences(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare v_role text;
begin
  v_role:=public.matmove_preferences_role(p_user_id);
  return jsonb_build_object('user_id',auth.uid(),'role',v_role,
    'places',coalesce((select jsonb_agg(to_jsonb(p) - 'user_id' order by p.kind) from public.matmove_saved_places p where p.user_id=auth.uid()),'[]'::jsonb),
    'cardReferences',coalesce((select jsonb_agg(to_jsonb(c) - 'user_id' order by c.created_at desc,c.id) from public.matmove_card_references c where c.user_id=auth.uid() and v_role in ('rider','merchant')),'[]'::jsonb));
end;
$fn$;

create or replace function public.matmove_save_place(p_user_id uuid, p_kind text,p_address text,p_latitude double precision,p_longitude double precision,p_expected bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare v public.matmove_saved_places%rowtype;
begin
  perform public.matmove_preferences_role(p_user_id);
  perform 1 from public.profiles where id=auth.uid() for update;
  if p_kind is null or p_kind not in ('home','work') or p_address is null or length(btrim(p_address)) not between 3 and 300 then raise exception 'INVALID: Enter a Home or Work address.'; end if;
  if (p_latitude is null) <> (p_longitude is null) or (p_latitude is not null and not(p_latitude between -90 and 90 and p_longitude between -180 and 180)) then raise exception 'INVALID: Location coordinates are invalid.'; end if;
  select * into v from public.matmove_saved_places where user_id=auth.uid() and kind=p_kind for update;
  if found then
    if p_expected is distinct from v.version then raise exception 'CONFLICT: Address changed. Refresh before editing.'; end if;
    update public.matmove_saved_places set address=btrim(p_address),latitude=p_latitude,longitude=p_longitude,version=version+1,updated_at=now() where user_id=auth.uid() and kind=p_kind returning * into v;
  else
    if p_expected is not null then raise exception 'CONFLICT: Address changed. Refresh before editing.'; end if;
    insert into public.matmove_saved_places(user_id,kind,address,latitude,longitude) values(auth.uid(),p_kind,btrim(p_address),p_latitude,p_longitude) returning * into v;
  end if;
  return to_jsonb(v)-'user_id';
end;
$fn$;

create or replace function public.matmove_delete_place(p_user_id uuid, p_kind text,p_expected bigint)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $fn$
begin
  perform public.matmove_preferences_role(p_user_id);
  perform 1 from public.profiles where id=auth.uid() for update;
  delete from public.matmove_saved_places where user_id=auth.uid() and kind=p_kind and version=p_expected;
  if not found then raise exception 'CONFLICT: Address changed. Refresh before deleting.'; end if;
  return true;
end;
$fn$;

create or replace function public.matmove_save_card_reference(p_user_id uuid, p_nickname text,p_brand text,p_last_four text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare v_role text; v public.matmove_card_references%rowtype;
begin
  v_role:=public.matmove_preferences_role(p_user_id);
  if v_role not in ('rider','merchant') then raise exception 'ACCESS: Card references are available to riders and merchants.'; end if;
  perform 1 from public.profiles where id=auth.uid() for update;
  if p_last_four is null or p_last_four !~ '^[0-9]{4}$' or p_brand is null or p_brand not in ('Visa','Mastercard','American Express','Other') or p_nickname is null or length(btrim(p_nickname)) not between 1 and 40 or btrim(p_nickname) !~ '^[[:alpha:] .''-]+$' then
    raise exception 'INVALID: Use a nickname with letters, card brand, and exactly four digits. Never enter a full card number.';
  end if;
  select * into v from public.matmove_card_references where user_id=auth.uid() and brand=p_brand and last_four=p_last_four;
  if found then return to_jsonb(v)-'user_id'; end if;
  if (select count(*) from public.matmove_card_references where user_id=auth.uid())>=5 then raise exception 'LIMIT: You can keep up to five card references.'; end if;
  insert into public.matmove_card_references(user_id,nickname,brand,last_four) values(auth.uid(),btrim(p_nickname),p_brand,p_last_four) returning * into v;
  return to_jsonb(v)-'user_id';
end;
$fn$;

create or replace function public.matmove_delete_card_reference(p_user_id uuid, p_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $fn$
begin
  perform public.matmove_preferences_role(p_user_id);
  delete from public.matmove_card_references where id=p_id and user_id=auth.uid();
  return found;
end;
$fn$;

revoke all on function public.matmove_preferences_role(uuid) from public,anon,authenticated;
revoke all on function public.matmove_home_preferences(uuid) from public,anon;
revoke all on function public.matmove_save_place(uuid,text,text,double precision,double precision,bigint) from public,anon;
revoke all on function public.matmove_delete_place(uuid,text,bigint) from public,anon;
revoke all on function public.matmove_save_card_reference(uuid,text,text,text) from public,anon;
revoke all on function public.matmove_delete_card_reference(uuid,uuid) from public,anon;
grant execute on function public.matmove_home_preferences(uuid) to authenticated;
grant execute on function public.matmove_save_place(uuid,text,text,double precision,double precision,bigint) to authenticated;
grant execute on function public.matmove_delete_place(uuid,text,bigint) to authenticated;
grant execute on function public.matmove_save_card_reference(uuid,text,text,text) to authenticated;
grant execute on function public.matmove_delete_card_reference(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;

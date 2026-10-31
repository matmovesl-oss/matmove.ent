
-- CUSTOMER: complete shared Supabase migration. Existing SLE listings remain SLE.
-- Listing foundations only; the matching merchant/buyer UI follows before deployment.
begin;
do $preflight$ begin
 if to_regclass('public.products') is null or to_regclass('storage.objects') is null
 or to_regprocedure('public.matmove_preferences_role(uuid)') is null
 or to_regclass('public.matmove_merchant_payments') is null then
  raise exception 'Install Home preferences and merchant payments first.';
 end if;
end $preflight$;
alter table public.products add column if not exists currency text not null default 'SLE';
alter table public.products add column if not exists image_paths text[] not null default '{}';
alter table public.products add column if not exists is_available boolean not null default true;
alter table public.products add column if not exists catalog_version bigint not null default 0;
alter table public.products add column if not exists catalog_updated_at timestamptz not null default now();

create or replace function public.matmove_catalog_is_merchant()
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $fn$
begin
 if auth.uid() is null then return false;end if;
 if exists(select 1 from public.matmove_staff_access where id=auth.uid() and is_active and removed_at is null) then return false;end if;
 return public.matmove_preferences_role(auth.uid())='merchant';
exception when others then return false;
end $fn$;

create or replace function public.matmove_catalog_paths(p_user uuid,p_paths text[])
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $fn$
declare path text;obj jsonb;
begin
 if p_paths is null or cardinality(p_paths)>3 or array_ndims(p_paths)>1 then return false;end if;
 if (select count(*) from unnest(p_paths))<>(select count(distinct v) from unnest(p_paths) v) then return false;end if;
 foreach path in array p_paths loop
  if path is null or path !~ ('^'||p_user::text||'(/|-)[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(jpg|jpeg|png|webp)$') then return false;end if;
  select to_jsonb(o) into obj from storage.objects o where o.bucket_id='product_images' and o.name=path;
  if not found or coalesce(obj->>'owner_id',obj->>'owner') is distinct from p_user::text
   or coalesce(obj->'metadata'->>'mimetype','') not in ('image/jpeg','image/png','image/webp')
   or coalesce(obj->'metadata'->>'size','') !~ '^[0-9]{1,10}$' then return false;end if;
  if (obj->'metadata'->>'size')::bigint not between 1 and 5242880 then return false;end if;
 end loop;
 return true;
end $fn$;

create or replace function public.matmove_catalog_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $fn$
begin
 if auth.uid() is not null and (new.merchant_id is distinct from auth.uid() or not public.matmove_catalog_is_merchant()) then raise exception 'FORBIDDEN: Only the owning merchant can change this product.';end if;
 if tg_op='UPDATE' and (new.id is distinct from old.id or new.merchant_id is distinct from old.merchant_id) then raise exception 'FORBIDDEN: Product identity and owner cannot change.';end if;
 if new.currency not in ('SLE','USD') or new.currency is null or new.is_available is null
 or new.price is null or new.price<=0 or new.price>999999999.99 or new.price<>round(new.price::numeric,2)
 or nullif(btrim(new.name),'') is null or length(new.name)>120
 or length(coalesce(new.description,''))>2000
 or not public.matmove_catalog_paths(new.merchant_id,new.image_paths) then raise exception 'INVALID: Check product name, price, currency and up to three owned uploaded images.';end if;
 -- Legacy flat public image URLs still work. New edits use verified object paths.
 if tg_op='INSERT' then new.catalog_version:=0;
 else new.catalog_version:=old.catalog_version+1;end if;
 new.catalog_updated_at:=clock_timestamp();return new;
end $fn$;
drop trigger if exists matmove_catalog_guard on public.products;
create trigger matmove_catalog_guard before insert or update on public.products for each row execute function public.matmove_catalog_guard();
alter table public.products enable row level security;
drop policy if exists matmove_catalog_read on public.products;
create policy matmove_catalog_read on public.products for select to authenticated using(true);
drop policy if exists matmove_catalog_insert on public.products;
create policy matmove_catalog_insert on public.products for insert to authenticated with check(merchant_id=auth.uid() and public.matmove_catalog_is_merchant());
drop policy if exists matmove_catalog_update on public.products;
create policy matmove_catalog_update on public.products for update to authenticated using(merchant_id=auth.uid() and public.matmove_catalog_is_merchant()) with check(merchant_id=auth.uid() and public.matmove_catalog_is_merchant());
drop policy if exists matmove_catalog_delete on public.products;
create policy matmove_catalog_delete on public.products for delete to authenticated using(merchant_id=auth.uid() and public.matmove_catalog_is_merchant());
-- Restrictive write policies contain any older permissive grants.
drop policy if exists matmove_catalog_insert_scope on public.products;
create policy matmove_catalog_insert_scope on public.products as restrictive for insert to authenticated with check(merchant_id=auth.uid() and public.matmove_catalog_is_merchant());
drop policy if exists matmove_catalog_update_scope on public.products;
-- Edits must pass the version-checked save RPC; the old UI only inserts/deletes.
create policy matmove_catalog_update_scope on public.products as restrictive for update to authenticated using(false) with check(false);
drop policy if exists matmove_catalog_delete_scope on public.products;
create policy matmove_catalog_delete_scope on public.products as restrictive for delete to authenticated using(merchant_id=auth.uid() and public.matmove_catalog_is_merchant());
revoke insert,update,delete on public.products from anon;
drop policy if exists matmove_catalog_anon_insert_block on public.products;
create policy matmove_catalog_anon_insert_block on public.products as restrictive for insert to anon with check(false);
drop policy if exists matmove_catalog_anon_update_block on public.products;
create policy matmove_catalog_anon_update_block on public.products as restrictive for update to anon using(false) with check(false);
drop policy if exists matmove_catalog_anon_delete_block on public.products;
create policy matmove_catalog_anon_delete_block on public.products as restrictive for delete to anon using(false);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('product_images','product_images',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists matmove_catalog_upload on storage.objects;
create policy matmove_catalog_upload on storage.objects for insert to authenticated with check(bucket_id='product_images' and public.matmove_catalog_is_merchant() and (name like auth.uid()::text||'/%' or name like auth.uid()::text||'-%'));
drop policy if exists matmove_catalog_upload_scope on storage.objects;
create policy matmove_catalog_upload_scope on storage.objects as restrictive for insert to authenticated with check(bucket_id<>'product_images' or (public.matmove_catalog_is_merchant() and (name like auth.uid()::text||'/%' or name like auth.uid()::text||'-%')));
drop policy if exists matmove_catalog_no_overwrite on storage.objects;
create policy matmove_catalog_no_overwrite on storage.objects as restrictive for update to authenticated using(bucket_id<>'product_images') with check(bucket_id<>'product_images');
drop policy if exists matmove_catalog_no_delete on storage.objects;
create policy matmove_catalog_no_delete on storage.objects as restrictive for delete to authenticated using(bucket_id<>'product_images');

create or replace function public.matmove_catalog_save(p_id uuid,p_expected bigint,p_name text,p_price numeric,p_currency text,p_description text,p_whatsapp text,p_image_paths text[],p_available boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare product public.products%rowtype;u uuid:=auth.uid();
begin
 if not public.matmove_catalog_is_merchant() then raise exception 'FORBIDDEN: Merchant customer access is required.';end if;
 if p_id is null or p_available is null or p_currency is null or p_whatsapp is null or p_whatsapp !~ '^\+[1-9][0-9]{6,14}$' or p_expected<0 then raise exception 'INVALID: Check the product and WhatsApp number.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,87192816));
 select * into product from public.products where id=p_id for update;
 if found then
  if product.merchant_id<>u then raise exception 'FORBIDDEN: Only the owning merchant can change this product.';end if;
  if p_expected is null then
   if product.name=btrim(p_name) and product.price=p_price and product.currency=p_currency and coalesce(product.description,'')=coalesce(btrim(p_description),'') and product.whatsapp_number=p_whatsapp and product.image_paths=p_image_paths and product.is_available=p_available then
    null; -- Original successful create retried with its exact UUID and payload.
   else raise exception 'CONFLICT: This product ID already has different details.';end if;
  else
   if product.catalog_version<>p_expected then raise exception 'CONFLICT: Product changed. Reload it before saving.';end if;
   update public.products set name=btrim(p_name),price=p_price,currency=p_currency,description=coalesce(btrim(p_description),''),whatsapp_number=p_whatsapp,image_paths=p_image_paths,image_url=null,is_available=p_available where id=p_id returning * into product;
  end if;
 else
  if p_expected is not null then raise exception 'CONFLICT: Product is no longer available to edit.';end if;
  insert into public.products(id,merchant_id,name,price,currency,description,whatsapp_number,image_paths,is_available)
  values(p_id,u,btrim(p_name),p_price,p_currency,coalesce(btrim(p_description),''),p_whatsapp,p_image_paths,p_available) returning * into product;
 end if;
 return jsonb_build_object('id',product.id,'merchant_id',product.merchant_id,'name',product.name,'price',product.price::text,'currency',product.currency,'description',product.description,'whatsapp_number',product.whatsapp_number,'image_paths',product.image_paths,'image_url',product.image_url,'is_available',product.is_available,'catalog_version',product.catalog_version::text,'catalog_updated_at',product.catalog_updated_at);
end $fn$;

-- Even an older payment preparation function must not insert a new USD/sold checkout.
create or replace function public.matmove_catalog_checkout_guard()
returns trigger language plpgsql set search_path=pg_catalog,public as $fn$
declare item jsonb;product public.products%rowtype;
begin
 if new.items is null or jsonb_typeof(new.items)<>'array' or jsonb_array_length(new.items) not between 1 and 50 then raise exception 'INVALID: Checkout products are required.';end if;
 for item in select value from jsonb_array_elements(new.items) loop
  select * into product from public.products where id=(item->>'productId')::uuid and merchant_id=new.merchant_id for share;
  if not found or product.currency<>'SLE' or not product.is_available then raise exception 'CONFLICT: Product is sold or does not support SLE wallet checkout.';end if;
 end loop;
 return new;
end $fn$;
drop trigger if exists matmove_catalog_checkout_guard on public.matmove_merchant_payments;
create trigger matmove_catalog_checkout_guard before insert on public.matmove_merchant_payments for each row execute function public.matmove_catalog_checkout_guard();
revoke all on function public.matmove_catalog_paths(uuid,text[]),public.matmove_catalog_guard(),public.matmove_catalog_checkout_guard() from public,anon,authenticated;
revoke all on function public.matmove_catalog_is_merchant(),public.matmove_catalog_save(uuid,bigint,text,numeric,text,text,text,text[],boolean) from public,anon,authenticated;
grant execute on function public.matmove_catalog_is_merchant(),public.matmove_catalog_save(uuid,bigint,text,numeric,text,text,text,text[],boolean) to authenticated;
notify pgrst,'reload schema';
commit;

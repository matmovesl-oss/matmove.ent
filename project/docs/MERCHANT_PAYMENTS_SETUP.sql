

begin;

alter table public.wallets add column if not exists is_frozen boolean not null default false;
alter table public.profiles add column if not exists is_wallet_frozen boolean not null default false;

create table if not exists public.matmove_merchant_payments (
 id uuid primary key default gen_random_uuid(),
 request_key text not null unique,
 payload_hash text not null,
 rider_id uuid not null references public.profiles(id),
 merchant_id uuid not null references public.profiles(id),
 source_account text not null,
 merchant_account text not null,
 escrow_account text not null,
 items jsonb not null,
 product_minor bigint not null check(product_minor > 0),
 delivery_minor bigint not null check(delivery_minor in (0,5000)),
 fee_minor bigint not null check(fee_minor >= 0),
 total_minor bigint not null,
 phone text not null,
 address text not null,
 state text not null default 'holding' check(state in ('holding','merchant_pending','completed','failed','review_required')),
 delivery_state text not null default 'not_requested' check(delivery_state in ('not_requested','awaiting_payment','funded')),
 error text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(rider_id <> merchant_id),
 check(source_account <> escrow_account and merchant_account <> escrow_account and source_account <> merchant_account),
 check(total_minor=product_minor+delivery_minor+fee_minor),
 check(fee_minor=floor(((product_minor+delivery_minor)::numeric+50)/100))
);
create table if not exists public.matmove_merchant_payment_legs (
 payment_id uuid not null references public.matmove_merchant_payments(id),
 kind text not null check(kind in ('hold','merchant')),
 source_account text not null,
 destination_account text not null,
 amount_minor bigint not null check(amount_minor>0),
 request_key text not null unique default gen_random_uuid()::text,
 provider_id text unique,
 status text not null default 'ready' check(status in ('ready','pending','processing','completed','failed','review_required')),
 attempted_at timestamptz,
 error text,
 updated_at timestamptz not null default now(),
 primary key(payment_id,kind)
);
create index if not exists matmove_merchant_payments_pending
 on public.matmove_merchant_payments(updated_at) where state in ('holding','merchant_pending');
alter table public.matmove_merchant_payments enable row level security;
alter table public.matmove_merchant_payment_legs enable row level security;
revoke all on public.matmove_merchant_payments,public.matmove_merchant_payment_legs from public,anon,authenticated;
grant all on public.matmove_merchant_payments,public.matmove_merchant_payment_legs to service_role;

alter table public.app_orders add column if not exists wallet_payment_id uuid references public.matmove_merchant_payments(id);
alter table public.app_orders add column if not exists wallet_payment_status text not null default 'unpaid';
alter table public.app_orders add column if not exists wallet_product_id uuid;
create unique index if not exists matmove_paid_order_product
 on public.app_orders(wallet_payment_id,wallet_product_id) where wallet_payment_id is not null;

create or replace function public.matmove_prepare_merchant_payment(p_key text,p_payload_hash text,p_rider uuid,p_merchant uuid,p_source text,p_destination text,p_escrow text,p_items jsonb,p_product bigint,p_delivery bigint,p_fee bigint,p_total bigint,p_phone text,p_address text)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare v public.matmove_merchant_payments%rowtype; w public.wallets%rowtype; item jsonb; product public.products%rowtype; actual bigint:=0;
begin
 select * into w from public.wallets where user_id=p_rider and currency='SLE' for update;
 if not found then raise exception 'FORBIDDEN: Rider wallet not found.'; end if;
 select * into v from public.matmove_merchant_payments where request_key=p_key;
 if found then
  if v.rider_id<>p_rider or v.payload_hash<>p_payload_hash then raise exception 'CONFLICT: Request key was already used for another checkout.'; end if;
  return to_jsonb(v);
 end if;
 if p_key !~ '^[a-f0-9]{64}$' or p_payload_hash !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'INVALID: Invalid checkout.'; end if;
 if coalesce(nullif(to_jsonb(w)->>'monime_account_id',''),w.metadata->>'monime_account_id') is distinct from p_source then raise exception 'CONFLICT: Wallet account changed.'; end if;
 if not exists(select 1 from public.profiles where id=p_rider and role='rider' and not coalesce(is_wallet_frozen,false))
  or exists(select 1 from public.wallets where user_id=p_rider and coalesce(is_frozen,false))
  or not exists(select 1 from public.profiles where id=p_merchant and role='merchant' and kyc_status='approved' and not coalesce(is_wallet_frozen,false))
  or exists(select 1 from public.wallets where user_id=p_merchant and coalesce(is_frozen,false)) then raise exception 'FORBIDDEN: Wallet is frozen or merchant approval is pending.'; end if;
 if not exists(select 1 from public.wallets m where user_id=p_merchant and currency='SLE' and coalesce(nullif(to_jsonb(m)->>'monime_account_id',''),m.metadata->>'monime_account_id')=p_destination) then raise exception 'CONFLICT: Merchant wallet account changed.'; end if;
 for item in select value from jsonb_array_elements(p_items) loop
  select * into product from public.products where id=(item->>'productId')::uuid and merchant_id=p_merchant for share;
  if not found or coalesce(to_jsonb(product)->>'currency','SLE')<>'SLE' or coalesce((to_jsonb(product)->>'is_available')::boolean,true)=false then raise exception 'CONFLICT: Product is sold or does not support SLE wallet checkout.';end if;
  if (item->>'quantity')::integer not between 1 and 100 or product.price<=0 or product.price<>round(product.price::numeric,2)
   or (item->>'unitMinor')::bigint<>(product.price::numeric*100)::bigint then raise exception 'CONFLICT: Product price changed. Review checkout again.'; end if;
  actual:=actual+(product.price::numeric*100)::bigint*(item->>'quantity')::integer;
 end loop;
 if actual<>p_product then raise exception 'CONFLICT: Product total changed.'; end if;
 insert into public.matmove_merchant_payments(request_key,payload_hash,rider_id,merchant_id,source_account,merchant_account,escrow_account,items,product_minor,delivery_minor,fee_minor,total_minor,phone,address,delivery_state)
 values(p_key,p_payload_hash,p_rider,p_merchant,p_source,p_destination,p_escrow,p_items,p_product,p_delivery,p_fee,p_total,p_phone,p_address,case when p_delivery>0 then 'awaiting_payment' else 'not_requested' end) returning * into v;
 insert into public.matmove_merchant_payment_legs(payment_id,kind,source_account,destination_account,amount_minor)
 values(v.id,'hold',p_source,p_escrow,p_total),(v.id,'merchant',p_escrow,p_destination,p_product);
 return to_jsonb(v);
end;
$$;

create or replace function public.matmove_record_merchant_leg(p_id uuid,p_kind text,p_provider_id text,p_status text,p_error text)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare v public.matmove_merchant_payments%rowtype; t public.matmove_merchant_payment_legs%rowtype; item jsonb;
begin
 select * into v from public.matmove_merchant_payments where id=p_id for update;
 if not found then raise exception 'NOT_FOUND: Checkout not found.'; end if;
 select * into t from public.matmove_merchant_payment_legs where payment_id=p_id and kind=p_kind for update;
 if not found then raise exception 'NOT_FOUND: Payment operation not found.'; end if;
 if p_status not in ('pending','processing','completed','failed','review_required') then raise exception 'INVALID: Invalid transfer status.'; end if;
 if t.provider_id is not null and p_provider_id is distinct from t.provider_id then raise exception 'CONFLICT: Provider receipt changed.'; end if;
 if t.status in ('completed','failed','review_required') or (t.status='processing' and p_status='pending') then return to_jsonb(v); end if;
 update public.matmove_merchant_payment_legs set provider_id=coalesce(t.provider_id,p_provider_id),status=p_status,error=p_error,updated_at=now() where payment_id=p_id and kind=p_kind;
 if p_status='review_required' then update public.matmove_merchant_payments set state='review_required',error=p_error where id=p_id;
 elsif p_status='failed' then
  update public.matmove_merchant_payments set state=case when p_kind='hold' then 'failed' else 'review_required' end,
   error=case when p_kind='hold' then p_error else 'Merchant credit failed. Funds remain in escrow; support must reconcile this payment.' end where id=p_id;
 elsif p_kind='hold' and p_status='completed' then
  update public.matmove_merchant_payments set state='merchant_pending',delivery_state=case when delivery_minor>0 then 'funded' else 'not_requested' end where id=p_id;
 elsif p_kind='merchant' and p_status='completed' then
  if v.state<>'merchant_pending' then raise exception 'INVALID: Escrow hold must complete before merchant credit.'; end if;
  for item in select value from jsonb_array_elements(v.items) loop
   insert into public.app_orders(rider_id,merchant_id,product_name,price,quantity,delivery_location,customer_phone,status,wallet_payment_id,wallet_payment_status,wallet_product_id)
   values(v.rider_id,v.merchant_id,item->>'name',((item->>'unitMinor')::numeric*(item->>'quantity')::integer)/100,(item->>'quantity')::integer,v.address,v.phone,'pending',v.id,'paid',(item->>'productId')::uuid);
  end loop;
  update public.matmove_merchant_payments set state='completed',error=null where id=p_id;
 end if;
 update public.matmove_merchant_payments set updated_at=now() where id=p_id returning * into v;
 return to_jsonb(v);
end;
$$;

create or replace function public.matmove_claim_merchant_leg(p_id uuid,p_kind text)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare v public.matmove_merchant_payments%rowtype; t public.matmove_merchant_payment_legs%rowtype; allowed boolean:=false;
begin
 select * into v from public.matmove_merchant_payments where id=p_id for update;
 if not found then raise exception 'NOT_FOUND: Checkout not found.'; end if;
 select * into t from public.matmove_merchant_payment_legs where payment_id=p_id and kind=p_kind for update;
 if not found then return null; end if;
 if v.state in ('completed','failed','review_required') then return to_jsonb(t)||jsonb_build_object('can_create',false); end if;
 if t.status='ready' and t.attempted_at is null then
  if (p_kind='hold' and v.state<>'holding') or (p_kind='merchant' and v.state<>'merchant_pending') then return to_jsonb(t)||jsonb_build_object('can_create',false); end if;
  if exists(select 1 from public.wallets where user_id in (v.rider_id,v.merchant_id) and coalesce(is_frozen,false))
   or not exists(select 1 from public.profiles where id=v.rider_id and role='rider' and not coalesce(is_wallet_frozen,false))
   or not exists(select 1 from public.profiles where id=v.merchant_id and role='merchant' and kyc_status='approved' and not coalesce(is_wallet_frozen,false))
   or not exists(select 1 from public.wallets w where user_id=v.rider_id and currency='SLE' and coalesce(nullif(to_jsonb(w)->>'monime_account_id',''),w.metadata->>'monime_account_id')=v.source_account)
   or not exists(select 1 from public.wallets w where user_id=v.merchant_id and currency='SLE' and coalesce(nullif(to_jsonb(w)->>'monime_account_id',''),w.metadata->>'monime_account_id')=v.merchant_account)
  then
   perform public.matmove_record_merchant_leg(p_id,p_kind,null,'failed','Wallet frozen, approval revoked or account link changed.');
   return to_jsonb(t)||jsonb_build_object('can_create',false);
  end if;
  allowed:=true;
  update public.matmove_merchant_payment_legs set status='pending',attempted_at=now(),updated_at=now() where payment_id=p_id and kind=p_kind returning * into t;
 elsif t.provider_id is null and t.status='pending' and t.attempted_at<now()-interval '2 minutes' then
  perform public.matmove_record_merchant_leg(p_id,p_kind,null,'review_required','Provider response uncertain. Verify receipts before retrying.');
 end if;
 return to_jsonb(t)||jsonb_build_object('can_create',allowed);
end;
$$;

create or replace function public.matmove_guard_paid_order()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if current_user not in ('postgres','service_role','supabase_admin') then
  if tg_op='INSERT' then
   if new.wallet_payment_id is not null or new.wallet_payment_status<>'unpaid' or new.wallet_product_id is not null then raise exception 'Wallet payment receipts require server authorization.'; end if;
  elsif new.wallet_payment_id is distinct from old.wallet_payment_id or new.wallet_payment_status is distinct from old.wallet_payment_status or new.wallet_product_id is distinct from old.wallet_product_id then
   raise exception 'Wallet payment receipts require server authorization.';
  elsif old.wallet_payment_id is not null and (new.price is distinct from old.price or new.quantity is distinct from old.quantity or new.product_name is distinct from old.product_name or new.rider_id is distinct from old.rider_id or new.merchant_id is distinct from old.merchant_id) then
   raise exception 'Paid order amounts and ownership cannot be changed.';
  end if;
 end if;
 return new;
end;
$$;
drop trigger if exists matmove_guard_paid_order on public.app_orders;
create trigger matmove_guard_paid_order before insert or update on public.app_orders for each row execute function public.matmove_guard_paid_order();
revoke all on function public.matmove_prepare_merchant_payment(text,text,uuid,uuid,text,text,text,jsonb,bigint,bigint,bigint,bigint,text,text),public.matmove_claim_merchant_leg(uuid,text),public.matmove_record_merchant_leg(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.matmove_prepare_merchant_payment(text,text,uuid,uuid,text,text,text,jsonb,bigint,bigint,bigint,bigint,text,text),public.matmove_claim_merchant_leg(uuid,text),public.matmove_record_merchant_leg(uuid,text,text,text,text) to service_role;
notify pgrst,'reload schema';
commit;

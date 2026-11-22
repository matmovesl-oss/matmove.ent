-- Require a verified provider transaction reference before a wallet top-up
-- can transition to completed. The trusted settlement RPC must supply the
-- provider's actual transaction reference; a checkout-session URL/ID alone is
-- not a settlement receipt.
begin;

create or replace function public.matmove_require_topup_provider_reference()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$
begin
  if lower(trim(coalesce(new.transaction_type, ''))) in ('wallet_topup', 'topup')
     and new.status = 'completed'
     and old.status is distinct from 'completed'
     and (
       nullif(trim(coalesce(new.provider_reference, '')), '') is null
       or new.provider_reference is not distinct from old.provider_reference
     ) then
    raise exception 'TOPUP_PROVIDER_REFERENCE_REQUIRED: A new provider transaction reference, different from the original checkout reference, is required before wallet top-up settlement.';
  end if;

  return new;
end;
$function$;

revoke all on function public.matmove_require_topup_provider_reference()
  from public, anon, authenticated;

drop trigger if exists matmove_require_topup_provider_reference
  on public.payment_transactions;

create trigger matmove_require_topup_provider_reference
before update of status, provider_reference
on public.payment_transactions
for each row
execute function public.matmove_require_topup_provider_reference();

comment on function public.matmove_require_topup_provider_reference() is
  'Blocks wallet top-up completion unless a new non-empty provider transaction reference replaces the original checkout reference.';

notify pgrst, 'reload schema';
commit;

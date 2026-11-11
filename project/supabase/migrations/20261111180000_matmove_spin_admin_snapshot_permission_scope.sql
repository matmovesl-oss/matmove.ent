-- Align the live Spin Admin RPC with per-section staff permissions.
-- This migration changes only RPC data scope and function EXECUTE grants.
-- It does not alter game settings, rounds, payment legs, wallets or ledger data.
-- MatMove Spin Admin least-privilege repair.
-- Apply only in an approved production maintenance window, after confirming
-- the two staff-base functions exist. This script changes RPC response scope
-- only; it does not update game configuration, player eligibility, payments,
-- wallets, provider accounts, or ledger records.
begin;

do $assert$
begin
 if to_regprocedure('public.matmove_spin_admin_snapshot()') is null
  or to_regprocedure('public.matmove_spin_admin_snapshot_staff_base()') is null then
  raise exception 'Expected Spin snapshot wrapper/base functions are missing. Stop and reconcile the installed schema before applying this repair.';
 end if;
 if to_regprocedure('public.matmove_spin_admin_report(text,integer,text,text,uuid)') is null
  or to_regprocedure('public.matmove_spin_admin_report_staff_base(text,integer,text,text,uuid)') is null then
  raise exception 'Expected Spin report wrapper/base functions are missing. Stop and reconcile the installed schema before applying this repair.';
 end if;
end;
$assert$;

create or replace function public.matmove_spin_admin_snapshot()
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $snapshot$
declare
 v_snapshot jsonb;
begin
 if auth.uid() is null then
  raise exception 'AUTH: Sign in to Admin.';
 end if;

 if not public.matmove_admin_can('games.settings') then
  raise exception 'FORBIDDEN: Game settings permission required.';
 end if;

 v_snapshot:=public.matmove_spin_admin_snapshot_staff_base();

 -- Never return the raw rounds, receipts or player-access arrays to browsers.
 return jsonb_build_object(
  'config',v_snapshot->'config',
  'entryReceivedMinor',case
   when public.matmove_admin_can('games.entries') then v_snapshot->'entryReceivedMinor'
   else null end,
  'winsPaidMinor',case
   when public.matmove_admin_can('games.winnings') then v_snapshot->'winsPaidMinor'
   else null end,
  'winsOwedMinor',case
   when public.matmove_admin_can('games.winnings') then v_snapshot->'winsOwedMinor'
   else null end,
  'reservedMinor',case
   when public.matmove_admin_any(ARRAY['games.overview','games.winnings']::text[])
    then v_snapshot->'reservedMinor'
   else null end
 );
end;
$snapshot$;

create or replace function public.matmove_spin_admin_report(
 p_view text,
 p_page integer default 1,
 p_search text default '',
 p_status text default 'all',
 p_player uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $report$
declare
 r jsonb;
 summary jsonb;
begin
 if auth.uid() is null or not public.matmove_admin_can(
  case p_view
   when 'rounds' then 'games.overview'
   when 'players' then 'games.players'
   when 'entries' then 'games.entries'
   when 'winnings' then 'games.winnings'
   else 'invalid'
  end
 ) then
  raise exception 'FORBIDDEN: Access denied for this assignment.';
 end if;

 r:=public.matmove_spin_admin_report_staff_base(p_view,p_page,p_search,p_status,p_player);
 summary:=r->'stats';

 if not public.matmove_admin_any(ARRAY['games.overview','games.players','games.winnings']::text[]) then
  summary:=summary-'winsPaidMinor'-'winsOwedMinor'-'prizesCredited';
 end if;
 if not public.matmove_admin_any(ARRAY['games.overview','games.players','games.entries']::text[]) then
  summary:=summary-'entryReceivedMinor'-'paidEntries'-'pendingEntries';
 end if;
 if not public.matmove_admin_any(ARRAY['games.overview','games.winnings']::text[]) then
  summary:=summary-'reservedMinor';
 end if;

 return jsonb_set(r,'{stats}',summary);
end;
$report$;

revoke all on function public.matmove_spin_admin_snapshot_staff_base() from public,anon,authenticated,service_role;
revoke all on function public.matmove_spin_admin_report_staff_base(text,integer,text,text,uuid) from public,anon,authenticated,service_role;

revoke all on function public.matmove_spin_admin_snapshot() from public,anon;
grant execute on function public.matmove_spin_admin_snapshot() to authenticated;

revoke all on function public.matmove_spin_admin_report(text,integer,text,text,uuid) from public,anon;
grant execute on function public.matmove_spin_admin_report(text,integer,text,text,uuid) to authenticated;

notify pgrst, 'reload schema';
commit;

-- Align assignment validation with the current shared registry. Grants no access.
begin;
create or replace function public.matmove_staff_permissions_valid(p_permissions jsonb)
returns boolean language sql immutable set search_path=pg_catalog,public as $permissions$
 select case when jsonb_typeof(p_permissions) is distinct from 'array' then false else
 jsonb_array_length(p_permissions) between 1 and 26
 and not exists(select 1 from jsonb_array_elements(p_permissions) e where jsonb_typeof(e)<>'string' or not(e#>>'{}'=any(ARRAY['dashboard','dispatch','concierge','travel.overview','travel.manifest','travel.boarding','travel.payments','events.overview','events.sales','events.checkin','pricing','kyc','customers','financials','special','transactions','payouts','games.overview','games.players','games.entries','games.winnings','games.settings','games.recovery','notifications','staff','logs']::text[])))
 and (select count(distinct e) from jsonb_array_elements(p_permissions) e)=jsonb_array_length(p_permissions)
 end;
$permissions$;
revoke all on function public.matmove_staff_permissions_valid(jsonb) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;

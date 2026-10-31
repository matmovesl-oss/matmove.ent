
-- CUSTOMER: run this COMPLETE file in the ONE shared Supabase SQL Editor.
-- Installs an INACTIVE job. Does not activate the campaign, reserve funds or send money.
-- Requires the existing referral payment setup. Never put a secret in this file.
begin;
create schema if not exists extensions;
create schema if not exists vault;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;
do $preflight$ begin
 if to_regclass('public.matmove_referral_rewards') is null
 or to_regprocedure('public.matmove_referral_claim(uuid)') is null
 or to_regclass('vault.decrypted_secrets') is null then
  raise exception 'Install the referral payment setup and Supabase Vault first.';
 end if;
end $preflight$;
create table if not exists public.matmove_referral_scheduler (
 singleton boolean primary key default true check(singleton),enabled boolean not null default false,
 request_id bigint,queued_at timestamptz,probe_id bigint,probe_nonce uuid,probe_at timestamptz
);
alter table public.matmove_referral_scheduler enable row level security;
revoke all on public.matmove_referral_scheduler from public,anon,authenticated;
insert into public.matmove_referral_scheduler(singleton) values(true) on conflict do nothing;

create or replace function public.matmove_referral_scheduler_ready()
returns boolean language sql stable security definer set search_path=pg_catalog,public as $ready$
 select to_regprocedure('public.matmove_referral_prepare(uuid,text,bigint,timestamp with time zone)') is not null
 and to_regprocedure('public.matmove_referral_claim(uuid)') is not null
 and to_regprocedure('public.matmove_referral_record(uuid,jsonb)') is not null
 and to_regprocedure('public.matmove_referral_defer(uuid,text)') is not null;
$ready$;

create or replace function public.matmove_referral_scheduler_probe()
returns bigint language plpgsql security definer set search_path=pg_catalog,public as $probe$
declare secret text;n uuid:=gen_random_uuid();rid bigint;s public.matmove_referral_scheduler%rowtype;
begin
 perform pg_advisory_xact_lock(87192815);
 select * into s from public.matmove_referral_scheduler where singleton for update;
 if s.probe_at>clock_timestamp()-interval '30 seconds' then return s.probe_id;end if;
 select decrypted_secret into strict secret from vault.decrypted_secrets where name='matmove_referral_cron_secret';
 if secret is null or length(secret)<32 or secret !~ '^[A-Za-z0-9_-]+$' then raise exception 'Use a random URL-safe cron secret with at least 32 characters.';end if;
 rid:=net.http_get(url:='https://matmoveent.vercel.app/api/get-live-wallet',
  params:=jsonb_build_object('action','referral_reconcile','probe','true','challenge',n::text),
  headers:=jsonb_build_object('Authorization','Bearer '||secret),timeout_milliseconds:=20000);
 update public.matmove_referral_scheduler set probe_id=rid,probe_nonce=n,probe_at=clock_timestamp() where singleton;
 return rid;
end;
$probe$;

create or replace function public.matmove_referral_scheduler_control(p_enabled boolean)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $control$
declare s public.matmove_referral_scheduler%rowtype;r record;b jsonb;j bigint;
begin
 perform pg_advisory_xact_lock(87192815);
 if p_enabled is null then raise exception 'Choose enabled or disabled explicitly.';end if;
 select * into s from public.matmove_referral_scheduler where singleton for update;
 select jobid into strict j from cron.job where jobname='matmove-referral-worker-v1';
 if p_enabled then
  if s.probe_at is null or s.probe_at<clock_timestamp()-interval '30 minutes' then raise exception 'Run a fresh no-payment connection probe first.';end if;
  select * into r from net._http_response where id=s.probe_id;
  if not found or r.status_code is distinct from 200 or r.timed_out is distinct from false then raise exception 'The connection probe has not succeeded. Keep the job disabled.';end if;
  begin b:=r.content::jsonb;exception when others then raise exception 'The probe response is invalid.';end;
  if b->>'service' is distinct from 'matmove-referrals-v1' or b->>'challenge' is distinct from s.probe_nonce::text
   or b->'schemaReady' is distinct from 'true'::jsonb or coalesce(b->>'sourceAccount','') !~ '^fac-[A-Za-z0-9_-]+$'
   or not public.matmove_referral_scheduler_ready() then raise exception 'The deployed referral worker was not verified.';end if;
  if exists(select 1 from public.matmove_referral_campaign where singleton and treasury_account is not null and treasury_account is distinct from b->>'sourceAccount') then raise exception 'The deployed treasury does not match the saved campaign.';end if;
 end if;
 update public.matmove_referral_scheduler set enabled=p_enabled where singleton;
 perform cron.alter_job(j,active:=p_enabled);
 return p_enabled;
end;
$control$;

create or replace function public.matmove_referral_scheduler_tick()
returns bigint language plpgsql security definer set search_path=pg_catalog,public as $tick$
declare s public.matmove_referral_scheduler%rowtype;secret text;rid bigint;
begin
 if not pg_try_advisory_xact_lock(87192815) then return null;end if;
 select * into s from public.matmove_referral_scheduler where singleton for update;
 if not coalesce(s.enabled,false) then return null;end if;
 -- Do not overlap retained HTTP work; after 90 seconds the bounded worker has expired.
 if s.queued_at>clock_timestamp()-interval '90 seconds' and not exists(select 1 from net._http_response where id=s.request_id) then return null;end if;
 -- Pausing new payments still permits checking a known original provider receipt.
 if not exists(select 1 from public.matmove_referral_rewards r where
   (r.provider_id is not null and r.state not in ('completed','failed'))
   or (r.state in ('pending','processing','review_required') and exists(select 1 from public.matmove_referral_campaign c where c.singleton and c.payments_enabled))) then return null;end if;
 select decrypted_secret into strict secret from vault.decrypted_secrets where name='matmove_referral_cron_secret';
 if secret is null or length(secret)<32 or secret !~ '^[A-Za-z0-9_-]+$' then raise exception 'The referral scheduler secret is missing or invalid.';end if;
 rid:=net.http_get(url:='https://matmoveent.vercel.app/api/get-live-wallet',params:=jsonb_build_object('action','referral_reconcile'),
  headers:=jsonb_build_object('Authorization','Bearer '||secret),timeout_milliseconds:=65000);
 update public.matmove_referral_scheduler set request_id=rid,queued_at=clock_timestamp() where singleton;
 return rid;
end;
$tick$;

create or replace function public.matmove_referral_scheduler_status()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $status$
declare s public.matmove_referral_scheduler%rowtype;j record;r record;p record;b jsonb;verified boolean:=false;
begin
 select * into s from public.matmove_referral_scheduler where singleton;
 select jobid,active,schedule into j from cron.job where jobname='matmove-referral-worker-v1';
 select status_code,timed_out into r from net._http_response where id=s.request_id;
 select status_code,timed_out,content into p from net._http_response where id=s.probe_id;
 if found and p.status_code=200 and p.timed_out=false and s.probe_at>clock_timestamp()-interval '30 minutes' then
  begin
   b:=p.content::jsonb;
   verified:=coalesce(b->>'service'='matmove-referrals-v1' and b->>'challenge'=s.probe_nonce::text
     and b->'schemaReady'='true'::jsonb and b->>'sourceAccount' ~ '^fac-[A-Za-z0-9_-]+$',false);
  exception when others then verified:=false;
  end;
 end if;
 return jsonb_build_object('enabled',s.enabled,'jobActive',j.active,'schedule',j.schedule,
 'lastQueuedAt',s.queued_at,'lastStatus',r.status_code,'lastTimedOut',r.timed_out,
 'probeVerified',verified,'probeSource',case when verified then b->>'sourceAccount' else null end,
 'probeQueuedAt',s.probe_at,'probeStatus',p.status_code,'probeTimedOut',p.timed_out,
 'secretPresent',exists(select 1 from vault.decrypted_secrets where name='matmove_referral_cron_secret'),
 'schemaReady',public.matmove_referral_scheduler_ready());
end;
$status$;

revoke all on function public.matmove_referral_scheduler_ready() from public,anon,authenticated;
revoke all on function public.matmove_referral_scheduler_probe() from public,anon,authenticated,service_role;
revoke all on function public.matmove_referral_scheduler_control(boolean) from public,anon,authenticated,service_role;
revoke all on function public.matmove_referral_scheduler_tick() from public,anon,authenticated,service_role;
revoke all on function public.matmove_referral_scheduler_status() from public,anon,authenticated;
grant execute on function public.matmove_referral_scheduler_ready() to service_role;
grant execute on function public.matmove_referral_scheduler_status() to service_role;
-- Preserve an existing job's active state. Re-running this migration never re-enables it.
do $job$ declare j bigint;
begin
 select jobid into j from cron.job where jobname='matmove-referral-worker-v1';
 if j is null then
  j:=cron.schedule('matmove-referral-worker-v1','* * * * *','select public.matmove_referral_scheduler_tick();');
  perform cron.alter_job(j,active:=false);
 end if;
end $job$;
notify pgrst,'reload schema';
commit;

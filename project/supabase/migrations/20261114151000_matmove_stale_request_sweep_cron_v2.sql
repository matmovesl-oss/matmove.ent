begin;

-- Vercel Hobby allows one daily cron. Keep high-frequency stale-request
-- ticketing/abandonment inside Supabase Cron; Vercel's daily cron handles
-- provider reconciliation with its own injected CRON_SECRET.
do $schedule$
declare
  old_job bigint;
begin
  select jobid into old_job
  from cron.job
  where jobname='matmove-ride-reconciliation-v1';
  if old_job is not null then
    perform cron.unschedule(old_job);
  end if;

  if not exists (
    select 1 from cron.job where jobname='matmove-stale-request-sweep-v1'
  ) then
    perform cron.schedule(
      'matmove-stale-request-sweep-v1',
      '*/5 * * * *',
      'select public.matmove_ride_stale_request_sweep();'
    );
  end if;
end;
$schedule$;

commit;

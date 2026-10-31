
# MatMove referral scheduler — staged deployment

This guide belongs in the CUSTOMER project. It contains instructions, not SQL to paste as a whole.

## Current stage: install inactive only

1. Save all five files from steps 76–80 in the Customer project.
2. Run the supplied Customer typecheck, build and tests.
3. In the ONE shared Supabase SQL Editor, run the COMPLETE contents of docs/REFERRAL_SCHEDULER_SETUP.sql, from begin to commit.
4. Verify that the job exists, is inactive, browser execution is denied and the campaign remains paused.
5. Stop here until the coordinated release and remaining checks are complete. Do not enable the Cron job in the Dashboard, set MATMOVE_REFERRALS_ENABLED=true or activate the campaign yet.

The setup uses Supabase pg_cron, pg_net and Vault. It creates one job named matmove-referral-worker-v1 with a one-minute schedule, but leaves both its job switch and its private enabled flag false. It does not change campaign flags, budget, reward eligibility, wallet balances or payment receipts. Re-running setup preserves existing switches and secrets.

If installation reports a missing/unavailable extension, enable the named extension through Supabase Database Extensions / Cron integration and retry the complete transaction. Never drop existing extensions: doing that can remove other jobs, queued requests or responses.

## Later release settings — do not activate now

The worker runs on the CUSTOMER Vercel deployment at:
https://matmoveent.vercel.app/api/get-live-wallet?action=referral_reconcile

Its server settings must include:
- Existing Supabase server credentials; never use a browser VITE variable for service-role credentials.
- Existing Monime API key and Space ID, matching the real Live environment.
- MONIME_ENVIRONMENT=live
- MONIME_REFERRAL_ACCOUNT_ID=fac-k6WJHuEadPmAnABzZGPncmkDNhC
- CRON_SECRET: a random URL-safe string of at least 32 characters, preferably 64 hexadecimal characters.

Use the SAME CRON_SECRET value in Supabase Vault under the exact name matmove_referral_cron_secret. Enter it privately through the Vault Add Secret screen. Never send the value in chat, commit it to GitHub, place it in a browser VITE setting or store it in a product table.

If CRON_SECRET already exists and is used by other jobs, preserve it if it meets these requirements. Do not replace a shared secret until all existing callers have been accounted for. If the old value cannot be recovered, coordinate the rotation instead of inventing a different value for this scheduler alone.

Vault encrypts stored secrets. pg_net temporarily places the Authorization header in its private database request queue while sending; keep the net and vault schemas out of the exposed Data API schemas. SQL connection administrators can inspect that queue. This design does not make a secret safe from a database administrator.

Vercel environment changes take effect on a new deployment. Both the new server/referral-api.js and its matching SQL must be installed before a connection test can pass. A successful local build does not test the deployed URL or the Monime credentials.

## Later no-payment connection test

After the coordinated deployment, with the campaign still paused, run this single statement in Supabase SQL Editor:

    select public.matmove_referral_scheduler_probe();

It queues an authenticated GET containing a random challenge. The probe branch checks server configuration and required SQL functions. It never calls Monime, reserves a reward or invokes the payment worker.

Because pg_net sends after the SQL transaction commits, inspect status in a SEPARATE subsequent query:

    select public.matmove_referral_scheduler_status();

Look for probeStatus 200 and probeTimedOut false. A 401 means the shared secret did not match; a 400 can mean the deployed endpoint is older; a 503 means deployment/schema/environment settings need attention. A null status means no response is available yet, not that the test passed. Do not paste the request headers or Vault contents when asking for help.

The control function also validates the exact challenge, service version, verified schema and treasury ID. A status 200 alone is not enough to bypass those checks. The no-payment probe confirms the deployed application and database connection; it does NOT prove that the external Monime API key, account balance or recipient accounts are usable. Those still require the final provider checks and normal receipt verification.

## Scheduler and campaign are separate controls

The scheduler control does not activate the campaign or increase its budget. Enabling later requires a successful connection probe within 30 minutes and a matching saved treasury if one is already configured. Full release instructions will follow after the remaining integration checks.

The payment worker handles at most one referral pair per HTTP invocation. A one-minute schedule is not a promise of immediate payment after KYC: queue depth, eligibility, provider status, capacity and manual reviews can delay processing. Known original transfer receipts can still be checked when new payments are paused. An uncertain transfer is never automatically resent with a new key.

After enabling later, normal status inspection is:

    select public.matmove_referral_scheduler_status();

Read lastQueuedAt, lastStatus and lastTimedOut together. No work to process means no HTTP call is queued. Job history showing a successful SQL call does not by itself prove a successful HTTP response or payment. pg_net responses normally expire after six hours; a missing old response must not be treated as success. The Cron job's own run history also needs a retention policy as operational history grows.

## Emergency stop

To stop THIS scheduler immediately, run:

    select public.matmove_referral_scheduler_control(false);

This disables both its private switch and the Cron job. It does not cancel a transfer already sent to Monime, undo a credit, release an uncertain reservation or pause other MatMove payment jobs. Pause new referral payments separately using the owner campaign control. Retain original request IDs and use the existing receipt recovery workflow for uncertain transfers.

## Sources checked for this implementation

- https://supabase.com/docs/guides/cron/quickstart
- https://supabase.com/docs/guides/functions/schedule-functions
- https://supabase.com/docs/guides/database/extensions/pg_net
- https://supabase.com/docs/guides/database/vault
- https://vercel.com/docs/cron-jobs/usage-and-pricing

Supabase scheduled HTTP calls and Vercel Functions consume their respective project resources. This implementation does not require a new AI service or a Vercel Pro cron schedule; it does not promise unlimited free hosting or bypass hosting-plan limits.

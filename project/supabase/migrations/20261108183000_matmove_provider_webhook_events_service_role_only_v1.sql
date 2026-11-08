-- Webhook event rows and their service-only RPCs are backend infrastructure.
-- RLS already has a service_role-only policy; remove unnecessary table grants
-- so an authenticated browser session cannot gain access if a policy changes.
revoke all privileges on table public.provider_webhook_events
from anon, authenticated;

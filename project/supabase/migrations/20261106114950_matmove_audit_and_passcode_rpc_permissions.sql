
-- Trigger-only helper: the trigger invokes it internally, never expose direct RPC execution.
revoke all on function public.matmove_admin_audit_capture() from public, anon, authenticated;

-- The audit feed is authenticated-only; its function also verifies active staff + logs permission.
revoke all on function public.matmove_admin_audit_feed(integer) from public, anon;
grant execute on function public.matmove_admin_audit_feed(integer) to authenticated;

-- Passcode operations require an authenticated MatMove customer session.
revoke all on function public.matmove_customer_passcode(text,text,text) from public, anon;
grant execute on function public.matmove_customer_passcode(text,text,text) to authenticated;

-- Keep the existing equivalent index; the new index was a duplicate.
drop index if exists public.admin_audit_logs_created_at_idx;

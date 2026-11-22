-- Close legacy anonymous mutation access. No balances or customer records change.
begin;
revoke execute on function public.admin_authorize_withdrawal(p_withdrawal_id uuid, p_reason text) from public,anon;
revoke execute on function public.admin_reject_withdrawal(p_withdrawal_id uuid, p_reason text) from public,anon;
revoke execute on function public.complete_and_settle_trip(p_booking_id uuid, p_driver_id uuid) from public,anon;
revoke execute on function public.create_wallets_for_matmove_role() from public,anon;
revoke execute on function public.create_wallets_for_profile_role() from public,anon;
revoke execute on function public.ensure_matmove_wallets(p_profile_id uuid) from public,anon;
revoke execute on function public.get_nearby_eligible_drivers(p_pickup_lat numeric, p_pickup_lng numeric, p_radius_km numeric) from public,anon;
revoke execute on function public.matmove_admin_bulk_update_role(p_user_ids uuid[], p_new_role text) from public,anon;
revoke execute on function public.matmove_admin_send_notification(p_request_key text, p_audience text, p_target_id uuid, p_title text, p_body text, p_destination text) from public,anon;
revoke execute on function public.matmove_admin_set_staff_role(p_user_id uuid) from public,anon;
revoke execute on function public.matmove_guard_travel_booking() from public,anon;
revoke execute on function public.matmove_spin_admin_outcomes(p_page integer) from public,anon;
revoke execute on function public.matmove_spin_admin_receipt(p_id uuid, p_index integer, p_provider text) from public,anon;
revoke execute on function public.matmove_spin_admin_report(p_view text, p_page integer, p_search text, p_status text, p_player uuid) from public,anon;
revoke execute on function public.matmove_spin_admin_save_six(p_expected bigint, p_enabled boolean, p_tiers jsonb) from public,anon;
revoke execute on function public.matmove_spin_admin_snapshot() from public,anon;
revoke execute on function public.process_gateway_payment(p_provider text, p_wallet_id uuid, p_amount numeric, p_currency text, p_reference text) from public,anon;
revoke execute on function public.review_kyc_submission(p_submission_id uuid, p_decision kyc_status, p_rejection_reason text) from public,anon;
revoke execute on function public.set_currency_rate(p_from_currency text, p_to_currency text, p_rate numeric, p_fee_percent numeric) from public,anon;
revoke execute on function public.set_updated_at() from public,anon;
revoke execute on function public.submit_customer_kyc_v2(p_role text, p_first_name text, p_last_name text, p_phone text, p_address text, p_documents jsonb, p_vehicle_type text, p_plate_number text, p_operating_region text, p_driver_license_no text, p_license_class text) from public,anon;
revoke execute on function public.process_gateway_payment(text,uuid,numeric,text,text) from authenticated;
revoke execute on function public.complete_and_settle_trip(uuid,uuid) from authenticated;
revoke execute on function public.ensure_matmove_wallets(uuid) from authenticated;
grant execute on function public.process_gateway_payment(text,uuid,numeric,text,text) to service_role;
grant execute on function public.complete_and_settle_trip(uuid,uuid) to service_role;
grant execute on function public.ensure_matmove_wallets(uuid) to service_role;
revoke all on public.kyc_storage_files from public,anon,authenticated;
grant select on public.kyc_storage_files to service_role;
create or replace function public.matmove_admin_set_staff_role(p_user_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $fn$
begin
 if not exists(select 1 from public.matmove_staff_access where id=(select auth.uid()) and is_active and is_owner and removed_at is null) then raise exception 'FORBIDDEN: Only the verified owner can change staff roles.'; end if;
 update public.profiles set role='staff' where id=p_user_id;
 return found;
end;$fn$;
create or replace function public.matmove_admin_bulk_update_role(p_user_ids uuid[],p_new_role text)
returns boolean language plpgsql security definer set search_path=pg_catalog as $fn$
begin
 if not exists(select 1 from public.matmove_staff_access where id=(select auth.uid()) and is_active and is_owner and removed_at is null) then raise exception 'FORBIDDEN: Only the verified owner can change roles.'; end if;
 if p_new_role not in ('rider','driver','merchant','staff') or cardinality(p_user_ids) not between 1 and 100 then raise exception 'INVALID: Unsupported role or selection.'; end if;
 update public.profiles set role=p_new_role where id=any(p_user_ids);
 return found;
end;$fn$;
revoke all on function public.matmove_admin_set_staff_role(uuid),public.matmove_admin_bulk_update_role(uuid[],text) from public,anon;
grant execute on function public.matmove_admin_set_staff_role(uuid),public.matmove_admin_bulk_update_role(uuid[],text) to authenticated;
notify pgrst,'reload schema';
commit;

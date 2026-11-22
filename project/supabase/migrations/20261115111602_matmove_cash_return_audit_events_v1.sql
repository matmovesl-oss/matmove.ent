alter table public.matmove_cash_ride_audit_events drop constraint if exists matmove_cash_ride_audit_events_event_type_check;
alter table public.matmove_cash_ride_audit_events add constraint matmove_cash_ride_audit_events_event_type_check
check(event_type = any(array[
 'cash_payment_created','reserve_requested','reserve_verified','driver_assigned',
 'driver_cash_confirmed','rider_cash_confirmed','capture_requested','capture_verified',
 'refund_requested','refund_verified','manual_review_opened','manual_review_resolved',
 'payment_cancelled','cash_return_requested','driver_cash_return_confirmed','rider_cash_return_confirmed'
]::text[]));
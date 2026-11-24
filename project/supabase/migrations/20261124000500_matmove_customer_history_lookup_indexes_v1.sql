begin;

-- Customer trip history and driver history are scoped by owner and displayed
-- newest-first. Composite indexes also cover the owner-only foreign-key lookups.
create index if not exists matmove_bookings_rider_created_idx
  on public.bookings (rider_id, created_at desc);

create index if not exists matmove_bookings_driver_created_idx
  on public.bookings (driver_id, created_at desc);

-- Rider and merchant order history follows the same owner/newest-first pattern.
create index if not exists matmove_app_orders_rider_created_idx
  on public.app_orders (rider_id, created_at desc);

create index if not exists matmove_app_orders_merchant_created_idx
  on public.app_orders (merchant_id, created_at desc);

commit;

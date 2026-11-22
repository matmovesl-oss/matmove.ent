begin;

-- Rider and driver trip history is queried by owner and newest-first creation time.
create index if not exists matmove_bookings_rider_created_idx
  on public.bookings (rider_id, created_at desc);

create index if not exists matmove_bookings_driver_created_idx
  on public.bookings (driver_id, created_at desc);

-- Rider and merchant order history uses the same owner/newest-first access pattern.
create index if not exists matmove_app_orders_rider_created_idx
  on public.app_orders (rider_id, created_at desc);

create index if not exists matmove_app_orders_merchant_created_idx
  on public.app_orders (merchant_id, created_at desc);

commit;

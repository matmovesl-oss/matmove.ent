# MatMove Customer Portal

A responsive frontend skeleton for the MatMove customer experience. It currently runs entirely on realistic Sierra Leone mock data so every key journey can be explored without authentication, payments, maps, or a production database.

## Structure

- `src/data/mockData.ts` contains customer, booking, wallet, transaction, schedule, promotion, notification, and saved-location models.
- `src/services/mockServices.ts` is the replaceable data boundary. Swap these functions for Supabase queries, Edge Functions, payment APIs, and map services later.
- `src/App.tsx` contains the responsive portal shell and page-level views with reusable UI patterns.
- `src/index.css` contains the visual system, responsive layout, and motion details.

## Route-ready page map

The current lightweight router exposes Dashboard, Book a Service, My Bookings, Scheduled Services, Wallet, Payments & Transactions, Promotions, Support, and Account. Booking details and trip tracking are reached from active booking actions and cards.

## Future integration points

- Supabase Auth replaces the mocked customer session.
- PostgreSQL tables and Realtime events replace mock bookings, schedules, notifications, and ledger data.
- Edge Functions can own pricing, payment confirmation, and operations handoff.
- Map and location providers can replace the map preview and route estimates.
- The UI already keeps customer-only actions separate from operations and administration capabilities.

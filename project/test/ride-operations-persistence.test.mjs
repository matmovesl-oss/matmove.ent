import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const trips=readFileSync(new URL('../src/components/TripHistory.tsx',import.meta.url),'utf8');
const driverDashboard=readFileSync(new URL('../src/pages/DriverDashboard.tsx',import.meta.url),'utf8');
const portal=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
const merchantDashboard=readFileSync(new URL('../src/pages/MerchantDashboard.tsx',import.meta.url),'utf8');
const contacts=readFileSync(new URL('../src/lib/tripContacts.ts',import.meta.url),'utf8');
const tripCardsMigration=readFileSync(new URL('../supabase/migrations/20261115115248_matmove_trip_payment_and_investigation_cards_v1.sql',import.meta.url),'utf8');
const unpaidCashMigration=readFileSync(new URL('../supabase/migrations/20261115115525_matmove_admin_flag_unpaid_cash_fare_v1.sql',import.meta.url),'utf8');
test('Trips centre has compact Active, Requests and History tabs',()=>{
 assert.match(trips,/label:'Active'/);
 assert.match(trips,/label:'Requests'/);
 assert.match(trips,/label:'History'/);
 assert.match(trips,/max-w-3xl/);
 assert.match(trips,/View full receipt/);
});
test('Driver and customer trip lists restore owned bookings and enrich participant/payment status',()=>{
 assert.match(trips,/\.eq\(role === 'driver' \? 'driver_id' : 'rider_id', id\)/);
 assert.match(trips,/attachTripContacts/);
 assert.match(trips,/readCashRideStatus/);
 assert.match(trips,/visibilitychange/);
 assert.match(trips,/postgres_changes/);
});
test('Trip detail shows who requested, who accepted, payment and handover status',()=>{
 assert.match(trips,/Customer phone/);
 assert.match(trips,/Driver phone/);
 assert.match(trips,/Payment method/);
 assert.match(trips,/Cash handover status/);
});

test('Trips loads bookings without invalid profile embeds and keeps last successful rows on refresh failure',()=>{
 assert.match(trips,/\.from\('bookings'\)\.select\('\*'\)/);
 assert.doesNotMatch(trips,/driver:driver_id|rider:rider_id/);
 assert.doesNotMatch(trips,/setTrips\(\[\]\);setError/);
 assert.match(trips,/attachTripContacts/);
});

test('Drivers can see Admin payment flags and verified cash/digital settlement status on their own trips',()=>{
 assert.match(contacts,/index \+= 100/);
 assert.match(contacts,/paymentInfo: card\.payment/);
 assert.match(contacts,/paymentIssue: card\.investigation/);
 assert.match(trips,/Driver payout status/);
 assert.match(trips,/Admin review/);
 assert.match(tripCardsMigration,/driverPayoutStatus/);
 assert.match(tripCardsMigration,/investigation/);
});

test('Admin unpaid cash-fare flag distinguishes the physical driver fare from the fee reserve',()=>{
 assert.match(unpaidCashMigration,/cp\.status <> 'collection_pending'/);
 assert.match(unpaidCashMigration,/cp\.driver_cash_confirmed_at is not null/);
 assert.match(unpaidCashMigration,/admin_unpaid_cash_fare_review/);
 assert.match(trips,/paymentIssue/);
});

test('Driver can resume the exact accepted ride from Trips into the live driver dashboard',()=>{
 assert.match(trips,/onResume\(t\.id\)/);
 assert.match(trips,/Continue trip/);
 assert.match(driverDashboard,/DriverTrips profile=\{props\.profile\} onResume=\{props\.onResumeTrip\}/);
 assert.match(driverDashboard,/r\.id===resumeTripId/);
 assert.match(portal,/rememberTrip\(bookingId\);setActiveSection\('ride'\)/);
});

test('Driver and merchant request lists use valid booking/profile retrieval paths',()=>{
 assert.match(driverDashboard,/\.select\('\*'\)/);
 assert.match(driverDashboard,/attachTripContacts\(visible\)/);
 assert.match(merchantDashboard,/profiles!app_orders_rider_id_fkey/);
 assert.doesNotMatch(driverDashboard,/profiles!rider_id/);
 assert.doesNotMatch(merchantDashboard,/rider:rider_id/);
});

test('Compact Requests tab continues to include cash reserve and cash review states',()=>{
 assert.match(trips,/cash_reserve_pending/);
 assert.match(trips,/cash_review_required/);
 assert.match(trips,/label:'Requests'/);
});

test('Trips loads only the current account owner records and keeps merchant orders separate',()=>{
 assert.match(trips,/\.eq\(role === 'driver' \? 'driver_id' : 'rider_id', id\)/);
 assert.match(merchantDashboard,/MerchantTrips profile=\{props\.profile\}/);
});

test('Rider and Merchant can create separately while unfinished requests remain in Trips',()=>{
 const negotiation=readFileSync(new URL('../src/lib/useRideNegotiation.ts',import.meta.url),'utf8');
 const request=readFileSync(new URL('../src/lib/useTripRequest.ts',import.meta.url),'utf8');
 const trips=readFileSync(new URL('../src/components/TripHistory.tsx',import.meta.url),'utf8');
 const rider=readFileSync(new URL('../src/pages/RiderDashboard.tsx',import.meta.url),'utf8');
 const merchant=readFileSync(new URL('../src/pages/MerchantDashboard.tsx',import.meta.url),'utf8');
 assert.match(negotiation,/const canCreate=current\.userId===userId&&!current\.loading&&!current\.error;/);
 assert.match(negotiation,/hasUnfinishedBookings:bookings\.some/);
 assert.match(negotiation,/const exact = selection\.current/);
 assert.match(negotiation,/const data = exact \|\| withCash\.find/);
 assert.match(trips,/onResume\(t\.id\)/);
 assert.doesNotMatch(rider,/CustomerTripSwitcher/);
 assert.doesNotMatch(merchant,/CustomerTripSwitcher/);
 assert.match(rider,/onOpenTrips/);
 assert.match(merchant,/onOpenTrips/);
 assert.match(request,/async function restore\(\)/);
 const restoreBlock=request.slice(request.indexOf('async function restore'),request.indexOf('async function submit'));
 assert.doesNotMatch(restoreBlock,/matmove_create_customer_trip|reserveCashRide/);
});
test('parallel customer request migration removes the server-side pending-booking creation block',()=>{
 const migration=readFileSync(new URL('../supabase/migrations/20261116095339_matmove_allow_parallel_customer_requests_v1.sql',import.meta.url),'utf8');
 assert.match(migration,/matmove_create_customer_trip\(uuid,jsonb\)/);
 assert.match(migration,/Resolve your pending request before creating another/);
 assert.match(migration,/v_updated := replace\(v_definition, v_old, ''\)/);
});

test('Admin digital dispute cancellation reconciles customer 50, driver 5 and platform 45 before closing',()=>{
 const settlement=readFileSync(new URL('../supabase/migrations/20261116095701_matmove_admin_dispute_escrow_split_v1.sql',import.meta.url),'utf8');
 const hardening=readFileSync(new URL('../supabase/migrations/20261116100213_matmove_harden_admin_dispute_split_retry_v1.sql',import.meta.url),'utf8');
 const payments=readFileSync(new URL('../server/ride-payments.js',import.meta.url),'utf8');
 assert.match(settlement,/rp\.fare_minor::numeric \* 0\.50/);
 assert.match(settlement,/rp\.fare_minor::numeric \* 0\.05/);
 assert.match(settlement,/platform_minor := rp\.fare_minor - refund_minor - driver_award_minor/);
 assert.match(settlement,/values\(b\.id,'refund',refund_minor/);
 assert.match(settlement,/values\(b\.id,'driver',driver_award_minor/);
 assert.match(settlement,/values\(b\.id,'fee',platform_minor/);
 assert.match(settlement,/p\.escrow_account = p\.fee_account/);
 assert.match(hardening,/amount_minor = p\.fare_minor/);
 assert.match(payments,/refundKinds = \['refund', \.\.\.legacyKinds\]/);
 assert.match(payments,/\.in\('kind', \['driver', 'fee'\]\)/);
});

test('Original request recovery verifies the exact saved reference and routes unresolved requests into Trips',()=>{
 const request=readFileSync(new URL('../src/lib/useTripRequest.ts',import.meta.url),'utf8');
 const rider=readFileSync(new URL('../src/pages/RiderDashboard.tsx',import.meta.url),'utf8');
 const merchant=readFileSync(new URL('../src/pages/MerchantDashboard.tsx',import.meta.url),'utf8');
 const trips=readFileSync(new URL('../src/components/TripHistory.tsx',import.meta.url),'utf8');
 const restore=request.slice(request.indexOf('async function restore'),request.indexOf('async function submit'));
 assert.match(restore,/\.eq\('id',savedRequest\.id\)\.eq\('rider_id',id\)/);
 assert.match(restore,/\.in\('status',\['pending','pending_admin','cash_reserve_pending','accepted','in_progress'\]\)/);
 assert.match(restore,/row&&\['cash_review_required','completed','cancelled'\]\.includes\(row\.status\)\)row=null/);
 assert.match(restore,/localStorage\.removeItem\(key\)/);
 for(const page of [rider,merchant]){
  assert.match(page,/tripRequest\.retained/);
  assert.match(page,/onOpenTrips\?\.\(\)/);
  assert.doesNotMatch(page,/CustomerTripSwitcher/);
 }
 assert.match(trips,/onResume\(t\.id\)/);
 assert.match(trips,/Continue request/);
});


test('Trip recovery clears the persisted pointer for review-only cash cases without removing the booking',()=>{
 const request=readFileSync(new URL('../src/lib/useTripRequest.ts',import.meta.url),'utf8');
 assert.ok(request.includes('const retainedRef = useRef<Saved | null>(null);'));
 assert.ok(request.includes('retainedRef.current=null;setRetained(null)'));
 assert.ok(request.includes("if(row&&['cash_review_required','completed','cancelled'].includes(row.status))row=null;"));
 assert.ok(request.includes('const savedRequest = retainedRef.current;'));
});

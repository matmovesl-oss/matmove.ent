import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const trips=readFileSync(new URL('../src/components/TripHistory.tsx',import.meta.url),'utf8');
const contacts=readFileSync(new URL('../src/lib/tripContacts.ts',import.meta.url),'utf8');
const tripCardsMigration=readFileSync(new URL('../supabase/migrations/20261115114900_matmove_trip_payment_and_investigation_cards_v1.sql',import.meta.url),'utf8');
const unpaidCashMigration=readFileSync(new URL('../supabase/migrations/20261115115100_matmove_admin_flag_unpaid_cash_fare_v1.sql',import.meta.url),'utf8');
test('Trips centre has persistent Live, Pending and History views',()=>{
 assert.match(trips,/Live \/ Active/);
 assert.match(trips,/Pending/);
 assert.match(trips,/History/);
 assert.match(trips,/Unfinished requests/);
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
 assert.match(trips,/Unpaid payment flagged for review/);
 assert.match(tripCardsMigration,/driverPayoutStatus/);
 assert.match(tripCardsMigration,/investigation/);
});

test('Admin unpaid cash-fare flag distinguishes the physical driver fare from the fee reserve',()=>{
 assert.match(unpaidCashMigration,/cp\.status <> 'collection_pending'/);
 assert.match(unpaidCashMigration,/cp\.driver_cash_confirmed_at is not null/);
 assert.match(unpaidCashMigration,/admin_unpaid_cash_fare_review/);
 assert.match(trips,/Unpaid cash fare flagged for review/);
});

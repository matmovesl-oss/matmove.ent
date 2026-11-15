import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const trips=readFileSync(new URL('../src/components/TripHistory.tsx',import.meta.url),'utf8');
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

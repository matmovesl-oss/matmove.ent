import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const trips=readFileSync(new URL('../src/components/TripHistory.tsx',import.meta.url),'utf8');
const server=readFileSync(new URL('../server/cash-ride-payments.js',import.meta.url),'utf8');
test('physical cash return requires both rider and driver confirmation before Admin cancellation',()=>{
 assert.match(trips,/matmove_cash_ride_confirm_return/);
 assert.match(trips,/Confirm cash returned to customer/);
 assert.match(trips,/Confirm cash returned to you/);
 assert.match(trips,/both_confirmed/);
});
test('cash status exposes the separate physical-return confirmation state',()=>{
 assert.match(server,/cashReturnStatus/);
 assert.match(server,/cash_return_driver_confirmed_at/);
 assert.match(server,/cash_return_rider_confirmed_at/);
});

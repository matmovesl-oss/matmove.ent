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

const terminalMigration=readFileSync(new URL('../supabase/migrations/20261115114500_matmove_admin_cash_return_terminal_booking_v1.sql',import.meta.url),'utf8');
test('verified Admin cash refund closes an in-progress booking only after both physical-return confirmations',()=>{
 assert.match(terminalMigration,/status=''in_progress'' and exists\\(select 1 from public\\.matmove_cash_ride_payments cpr/);
 assert.match(terminalMigration,/cpr\\.status=''refunded'' and cpr\\.cash_return_status=''refunded''/);
 assert.match(terminalMigration,/cash_review_required/);
});

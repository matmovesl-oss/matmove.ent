import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('new digital rides fail closed when escrow and fee destinations are not distinct',async()=>{
 const [server,migration]=await Promise.all([
  read('../server/ride-payments.js'),
  read('../supabase/migrations/20261114101448_matmove_ride_payment_distinct_financial_accounts.sql')
 ]);
 assert.match(server,/if \(escrow === revenue\)/);
 assert.match(server,/The SLE escrow and platform fee accounts must be separate/);
 assert.match(server,/p_escrow_account: platform\.escrow/);
 assert.match(server,/p_fee_account: platform\.revenue/);
 assert.match(migration,/ride_payments_active_platform_accounts_distinct/);
 assert.match(migration,/state IN \('released','refunded','failed'\)/);
 assert.match(migration,/escrow_account <> fee_account/);
 assert.match(migration,/NOT VALID/);
});

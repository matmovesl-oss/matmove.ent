import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('account closure is blocked while cash settlement or cash review is unresolved',async()=>{
 const sql=await readFile('supabase/migrations/20261117130000_matmove_account_deletion_cash_review_guard_v1.sql','utf8');
 assert.match(sql,/cash_review_required/);
 assert.match(sql,/matmove_cash_ride_payments/);
 assert.match(sql,/cp\.status not in \('settled','refunded','cancelled'\)/);
 assert.match(sql,/matmove_cash_ride_legs/);
 assert.match(sql,/l\.status in \('ready','pending','processing','review_required'\)/);
 assert.match(sql,/cash ride settlement, refund or manual review is unresolved/i);
 assert.match(sql,/revoke all on function public\.matmove_customer_request_account_deletion\(text\) from public, anon/i);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {checkoutWalletCredit} from '../server/monime-webhook-processing.js';

const valid={
  id:'chk-matmove-001',
  status:'completed',
  financialAccountId:'fac-wallet-001',
  metadata:{userId:'123e4567-e89b-42d3-a456-426614174000',role:'rider'},
  lineItems:{data:[{name:'Wallet Load',price:{currency:'SLE',value:12500},quantity:1}]}
};

test('only a completed single-line MatMove SLE wallet load is eligible for credit',()=>{
  assert.deepEqual(checkoutWalletCredit(valid),{
    checkoutSessionId:'chk-matmove-001',
    financialAccountId:'fac-wallet-001',
    userId:'123e4567-e89b-42d3-a456-426614174000',
    role:'rider',
    amountMinor:12500
  });
});
test('pending checkout sessions cannot credit a wallet',()=>{
  assert.equal(checkoutWalletCredit({...valid,status:'pending'}),null);
});
test('wrong account ID, user ID or missing metadata cannot credit',()=>{
  assert.equal(checkoutWalletCredit({...valid,financialAccountId:'bad'}),null);
  assert.equal(checkoutWalletCredit({...valid,metadata:{userId:'other'}}),null);
  assert.equal(checkoutWalletCredit({...valid,metadata:{}}),null);
});
test('wrong currency, zero/unsafe amount or modified quantity cannot credit',()=>{
  assert.equal(checkoutWalletCredit({...valid,lineItems:{data:[{...valid.lineItems.data[0],price:{currency:'USD',value:12500}}]}}),null);
  assert.equal(checkoutWalletCredit({...valid,lineItems:{data:[{...valid.lineItems.data[0],price:{currency:'SLE',value:0}}]}}),null);
  assert.equal(checkoutWalletCredit({...valid,lineItems:{data:[{...valid.lineItems.data[0],quantity:2}]}}),null);
  assert.equal(checkoutWalletCredit({...valid,lineItems:{data:[valid.lineItems.data[0],valid.lineItems.data[0]]}}),null);
});
test('only the exact wallet-load product is eligible',()=>{
  assert.equal(checkoutWalletCredit({...valid,lineItems:{data:[{...valid.lineItems.data[0],name:'Other product'}]}}),null);
});

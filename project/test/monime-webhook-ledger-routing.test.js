import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyMonimeTransfer } from '../server/monime-webhook-worker.js';

const rideId = '11111111-1111-4111-8111-111111111111';
const merchantId = '22222222-2222-4222-8222-222222222222';
const purchaseId = '33333333-3333-4333-8333-333333333333';
const withdrawalId = '44444444-4444-4444-8444-444444444444';

function event(eventType = 'internal_transfer.completed', objectType = 'internal_transfer') {
  return { event_type: eventType, object_type: objectType, object_id: 'itr-test' };
}

test('routes completed internal transfers to exactly one supported MatMove ledger family', () => {
  assert.deepEqual(classifyMonimeTransfer(event(), { metadata: { bookingId: rideId } }), {
    kind: 'ride', id: rideId, resource: 'internal-transfers'
  });
  assert.deepEqual(classifyMonimeTransfer(event(), { metadata: { merchantPaymentId: merchantId } }), {
    kind: 'merchant', id: merchantId, resource: 'internal-transfers'
  });
  assert.deepEqual(classifyMonimeTransfer(event(), { metadata: { matmovePurchasePaymentId: purchaseId } }), {
    kind: 'purchase', id: purchaseId, resource: 'internal-transfers'
  });
  assert.deepEqual(classifyMonimeTransfer(event(), { metadata: { matmoveWithdrawalId: withdrawalId } }), {
    kind: 'withdrawal', id: withdrawalId, resource: 'internal-transfers'
  });
});

test('routes only supported terminal payout events to withdrawal reconciliation', () => {
  assert.deepEqual(classifyMonimeTransfer(event('payout.completed', 'payout'), {
    metadata: { matmoveWithdrawalId: withdrawalId }
  }), { kind: 'withdrawal', id: withdrawalId, resource: 'payouts' });
  assert.deepEqual(classifyMonimeTransfer(event('payout.failed', 'payout'), {
    metadata: { matmoveWithdrawalId: withdrawalId }
  }), { kind: 'withdrawal', id: withdrawalId, resource: 'payouts' });
  assert.equal(classifyMonimeTransfer(event('payout.processing', 'payout'), {
    metadata: { matmoveWithdrawalId: withdrawalId }
  }), null);
});

test('quarantines ambiguous, malformed, unsupported and non-terminal transfer events', () => {
  assert.equal(classifyMonimeTransfer(event(), { metadata: {} }), null);
  assert.equal(classifyMonimeTransfer(event(), {
    metadata: { bookingId: rideId, merchantPaymentId: merchantId }
  }), null);
  assert.equal(classifyMonimeTransfer(event('internal_transfer.processing'), {
    metadata: { bookingId: rideId }
  }), null);
  assert.equal(classifyMonimeTransfer(event('payment.completed', 'payment'), {
    metadata: { bookingId: rideId }
  }), null);
  assert.equal(classifyMonimeTransfer(event(), {
    metadata: { bookingId: 'not-a-uuid' }
  }), null);
});

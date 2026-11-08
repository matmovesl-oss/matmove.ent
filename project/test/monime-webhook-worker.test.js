import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAuthorizedCronRequest,
  classifyMonimeWebhookEvent
} from '../server/monime-webhook-worker.js';

const secret='test-cron-secret-that-is-long-enough-123456';

test('cron worker accepts only the configured bearer secret',()=>{
  assert.equal(isAuthorizedCronRequest({headers:{authorization:'Bearer '+secret}},secret),true);
  assert.equal(isAuthorizedCronRequest({headers:{authorization:'Bearer wrong'}},secret),false);
  assert.equal(isAuthorizedCronRequest({headers:{}},secret),false);
  assert.equal(isAuthorizedCronRequest({headers:{authorization:'Bearer '+secret}},''),false);
  assert.equal(isAuthorizedCronRequest({headers:{authorization:'Bearer short'}},'short'),false);
});

test('only completed checkout-session events with a bounded session id are queued for wallet credit',()=>{
  assert.equal(classifyMonimeWebhookEvent({type:'checkout_session.completed',data:{id:'chk-1234'}}),'checkout');
  assert.equal(classifyMonimeWebhookEvent({type:'payment.created',data:{id:'pay-1234'}}),'ignored');
  assert.equal(classifyMonimeWebhookEvent({type:'checkout_session.completed',data:{id:'x'}}),'ignored');
  assert.equal(classifyMonimeWebhookEvent({type:'checkout_session.completed',data:{id:'x'.repeat(161)}}),'ignored');
  assert.equal(classifyMonimeWebhookEvent(null),'ignored');
});

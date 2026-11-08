import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readMonimeRawBody,verifyMonimeWebhookSignature,parseMonimeWebhook} from '../server/monime-webhook-security.js';

const secret = 'matmove-webhook-secret-for-tests-only';
const now = 1794160800;
const body = Buffer.from('{"id":"wke-test-001","type":"checkout_session.completed","data":{"id":"chk-123"}}');
const sign = (timestamp, raw = body) => 't=' + timestamp + ',v1=' + createHmac('sha256',secret).update(String(timestamp)+'_').update(raw).digest('base64');

test('Monime signature accepts exact raw body and documented HMAC format',()=>{
  assert.equal(verifyMonimeWebhookSignature(body,sign(now),secret,now),true);
});
test('signature fails when raw body changes by one byte',()=>{
  const altered=Buffer.from(body.toString().replace('chk-123','chk-124'));
  assert.equal(verifyMonimeWebhookSignature(altered,sign(now),secret,now),false);
});
test('signature rejects stale timestamps older than five minutes',()=>{
  const timestamp=now-301;
  assert.equal(verifyMonimeWebhookSignature(body,sign(timestamp),secret,now),false);
});
test('signature rejects timestamps more than one minute in the future',()=>{
  const timestamp=now+61;
  assert.equal(verifyMonimeWebhookSignature(body,sign(timestamp),secret,now),false);
});
test('signature rejects missing secrets, malformed headers and duplicate fields',()=>{
  assert.equal(verifyMonimeWebhookSignature(body,sign(now),'',now),false);
  assert.equal(verifyMonimeWebhookSignature(body,'t=bad,v1=nope',secret,now),false);
  assert.equal(verifyMonimeWebhookSignature(body,sign(now)+',v1=another',secret,now),false);
});
test('raw-body reader preserves exact bytes and enforces its size limit',async()=>{
  const req={headers:{},async *[Symbol.asyncIterator](){yield body.subarray(0,12);yield body.subarray(12);}};
  assert.deepEqual(await readMonimeRawBody(req),body);
  const large={headers:{},async *[Symbol.asyncIterator](){yield Buffer.alloc(10);}};
  await assert.rejects(readMonimeRawBody(large,5),error=>error.status===413);
});
test('webhook envelope requires a Monime event ID, event type and object data',()=>{
  assert.deepEqual(parseMonimeWebhook(body),{id:'wke-test-001',type:'checkout_session.completed',data:{id:'chk-123'}});
  assert.equal(parseMonimeWebhook(Buffer.from('{"id":"fake","type":"payment.created","data":{}}')),null);
  assert.equal(parseMonimeWebhook(Buffer.from('{"id":"wke-1","type":"payment.created","data":[]}')),null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/components/CustomerSupport.tsx', import.meta.url), 'utf8');

test('customer conversation polling does not fetch the ticket list twice', () => {
  const start = source.indexOf('const loadMessages=useCallback(async(conversationId:string)=>{');
  const end = source.indexOf('\n },[userId]);', start);
  assert.ok(start >= 0 && end > start, 'loadMessages should be an independent callback');
  assert.equal(source.slice(start, end).includes('loadTickets'), false);
  assert.ok(source.includes("if(document.visibilityState==='visible'){void loadTickets();if(selected)void loadMessages(selected);}"));
});

test('customer replies explicitly refresh both the conversation and ticket list', () => {
  assert.ok(source.includes("setReply('');await Promise.all([loadMessages(selected),loadTickets()]);"));
});

test('customer inbox ignores out-of-order responses for tickets and conversations', () => {
  assert.ok(source.includes('const ticketRequest=useRef(0),messageRequest=useRef(0)'));
  assert.ok(source.includes('sequence!==ticketRequest.current'));
  assert.ok(source.includes('sequence!==messageRequest.current'));
  assert.ok(source.includes('ticketRequest.current++;messageRequest.current++;'));
});

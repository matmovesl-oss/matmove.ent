import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  publicEncrypt,
  randomBytes,
  constants
} from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  decryptUssdExchange,
  encryptUssdExchange,
  getPublicReceiveLink,
  processReceiveSmsOutbox,
  reconcileReceivePaymentEvent,
  receiveCheckoutReturn,
  resolveUssdExchange
} from '../server/receive-money.js';

const paymentId = '00000000-0000-4000-8000-000000000123';
const linkId = '00000000-0000-4000-8000-000000000456';
const sessionId = '00000000-0000-4000-8000-000000000789';

function encryptedRequest(payload, publicKey) {
  const aesKey = randomBytes(16);
  const encryptedAesKey = publicEncrypt({
    key: publicKey,
    padding: constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256'
  }, aesKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-128-gcm', aesKey, iv, { authTagLength: 16 });
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const blob = Buffer.alloc(1 + iv.length + ciphertext.length + tag.length);
  blob[0] = iv.length;
  iv.copy(blob, 1);
  ciphertext.copy(blob, 13);
  tag.copy(blob, 13 + ciphertext.length);
  return {
    body: {
      encryptedAesKey: encryptedAesKey.toString('base64'),
      encryptedExchangeData: blob.toString('base64')
    },
    aesKey
  };
}

function decryptReply(reply, aesKey) {
  const blob = Buffer.from(reply, 'base64');
  const ivLength = blob[0];
  const iv = blob.subarray(1, 1 + ivLength);
  const tag = blob.subarray(blob.length - 16);
  const ciphertext = blob.subarray(1 + ivLength, blob.length - 16);
  const decipher = createDecipheriv('aes-128-gcm', aesKey, iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
}

class Query {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.filters = [];
    this.operation = 'select';
    this.values = null;
    this.columns = '*';
  }
  select(columns = '*') { this.columns = columns; return this; }
  eq(key, value) { this.filters.push(row => row[key] === value); return this; }
  neq(key, value) { this.filters.push(row => row[key] !== value); return this; }
  insert(values) { this.operation = 'insert'; this.values = values; return this; }
  update(values) { this.operation = 'update'; this.values = values; return this; }
  project(row) {
    if (!row) return null;
    if (this.columns === '*' || !this.columns) return { ...row };
    return Object.fromEntries(this.columns.split(',').map(key => [key, row[key]]));
  }
  async execute(single = false) {
    const rows = this.db.tables[this.table] || (this.db.tables[this.table] = []);
    if (this.operation === 'insert') {
      if (this.table === 'matmove_receive_sms_outbox' && rows.some(row => row.payment_id === this.values.payment_id)) {
        return { data: null, error: { code: '23505' } };
      }
      const row = { ...this.values };
      rows.push(row);
      return { data: single ? this.project(row) : null, error: null };
    }
    const matches = rows.filter(row => this.filters.every(predicate => predicate(row)));
    if (this.operation === 'update') {
      for (const row of matches) Object.assign(row, this.values);
      return { data: single ? this.project(matches[0]) : null, error: null };
    }
    return { data: single ? this.project(matches[0]) : matches.map(row => this.project(row)), error: null };
  }
  maybeSingle() { return this.execute(true); }
  single() { return this.execute(true); }
  then(resolve, reject) { return this.execute(false).then(resolve, reject); }
}

function makeDb() {
  const link = {
    id: linkId,
    user_id: '00000000-0000-4000-8000-000000000999',
    wallet_id: '00000000-0000-4000-8000-000000000888',
    financial_account_id: 'fac-matmove-recipient',
    payment_target_ref: '23276543210',
    recipient_code: 'MM-ABCDEFGH',
    public_name: 'MatMove Merchant',
    enabled: true,
    sms_receipts_enabled: false
  };
  const wallet = {
    id: link.wallet_id,
    user_id: link.user_id,
    currency: 'SLE',
    is_frozen: false,
    monime_account_id: link.financial_account_id,
    metadata: {}
  };
  const payment = {
    id: paymentId,
    link_id: linkId,
    owner_user_id: link.user_id,
    wallet_id: link.wallet_id,
    provider_account_id: link.financial_account_id,
    provider_channel: 'ussd',
    provider_object_id: 'pay-test-receive',
    reference: 'MM-000000000123',
    idempotency_key: 'ussd:' + sessionId,
    amount_minor: 2500,
    currency: 'SLE',
    state: 'processing'
  };
  const db = {
    tables: {
      matmove_receive_links: [link],
      wallets: [wallet],
      profiles: [{ id: link.user_id, is_wallet_frozen: false, phone: '+23276543210' }],
      matmove_received_payments: [payment],
      matmove_receive_sms_outbox: []
    },
    from(table) { return new Query(this, table); }
  };
  return { db, link, wallet, payment };
}

test('Monime checkout success POST safely redirects to the MatMove confirmation page', () => {
  let statusCode = 0;
  let location = '';
  let ended = false;
  const res = {
    setHeader(name, value) { if (name.toLowerCase() === 'location') location = value; },
    status(value) { statusCode = value; return this; },
    end() { ended = true; return this; }
  };
  receiveCheckoutReturn({
    method: 'POST',
    query: { ref: 'MM-ABCDEF123456' }
  }, res);
  assert.equal(statusCode, 303);
  assert.equal(location, 'https://matmove.space/pay/complete?ref=MM-ABCDEF123456');
  assert.equal(ended, true);
});

test('Monime USSD RSA-OAEP-SHA256 and AES-128-GCM exchange decrypts and encrypts correctly', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  const payload = {
    global: { sessionId, networkProviderName: 'Orange Money' },
    currentPage: 'confirm_payment',
    flowData: { enter_recipient: 'MM-ABCDEFGH', enter_amount: '25', confirm_payment: 'true' }
  };
  const encrypted = encryptedRequest(payload, publicKey);
  const decoded = decryptUssdExchange(encrypted.body, privateKey);
  assert.deepEqual(decoded.data, payload);
  const response = { action: 'navigate', pageId: 'collect_payment', pageData: { amount: 25 } };
  const reply = encryptUssdExchange(response, decoded.aesKey);
  assert.deepEqual(decryptReply(reply, encrypted.aesKey), response);
});

test('receive link lookup is disabled by default and performs no public database lookup', async () => {
  const previous = process.env.MATMOVE_RECEIVE_MONEY_ENABLED;
  delete process.env.MATMOVE_RECEIVE_MONEY_ENABLED;
  let queries = 0;
  const db = { from() { queries++; throw new Error('must not query while disabled'); } };
  try {
    assert.equal(await getPublicReceiveLink(db, 'abcdefghijklmnopqrstuvwx12345678'), null);
    assert.equal(queries, 0);
  } finally {
    if (previous === undefined) delete process.env.MATMOVE_RECEIVE_MONEY_ENABLED;
    else process.env.MATMOVE_RECEIVE_MONEY_ENABLED = previous;
  }
});

test('USSD exchange fails closed when either receive-money gate is disabled', async () => {
  const payload = { global: { sessionId }, currentPage: 'enter_recipient', flowData: {} };
  const result = await resolveUssdExchange(payload, { enabled: false });
  assert.deepEqual(result, {
    action: 'stop',
    message: 'MatMove USSD payments are not enabled yet. Please use the MatMove payment link.'
  });
});

test('USSD recipient confirmation returns the verified UVAN and a unique payment reference', async () => {
  const { db, link } = makeDb();
  db.tables.matmove_received_payments = [];
  const payload = {
    global: { sessionId },
    currentPage: 'confirm_payment',
    flowData: {
      enter_recipient: 'MM-ABCDEFGH',
      enter_amount: '25',
      confirm_payment: 'true'
    }
  };
  const result = await resolveUssdExchange(payload, {
    db,
    enabled: true,
    verify: async () => ({ id: link.financial_account_id, currency: 'SLE', uvan: link.payment_target_ref })
  });
  assert.equal(result.action, 'navigate');
  assert.equal(result.pageId, 'collect_payment');
  assert.equal(result.pageData.paymentTargetRef, link.payment_target_ref);
  assert.equal(result.pageData.amount, 25);
  assert.equal(result.pageData.receiveLinkId, linkId);
  assert.equal(result.pageData.receivePaymentId, db.tables.matmove_received_payments[0].id);
  assert.match(result.pageData.reference, /^MM-[A-F0-9]{12}$/);
  assert.equal(db.tables.matmove_received_payments[0].state, 'processing');
  assert.equal(db.tables.matmove_received_payments[0].provider_channel, 'ussd');
});

test('incoming USSD payment completes only when final Monime payment matches account, amount and reference', async () => {
  const { db, payment } = makeDb();
  const event = { object_id: 'pay-test-receive', object_type: 'payment', event_type: 'payment.processing_completed' };
  const providerObject = {
    id: 'pay-test-receive',
    status: 'completed',
    financialAccountId: payment.provider_account_id,
    amount: { currency: 'SLE', value: 2500 },
    reference: payment.reference,
    metadata: { mmReceivePayId: payment.id }
  };
  const result = await reconcileReceivePaymentEvent(db, event, providerObject);
  assert.equal(result, 'processed');
  assert.equal(payment.state, 'completed');
  assert.ok(payment.completed_at);
  assert.equal(payment.provider_object_id, event.object_id);
  assert.equal(db.tables.matmove_receive_sms_outbox.length, 0);
});

test('verified incoming payment queues one opt-in SMS even when the completion webhook is retried', async () => {
  const { db, link, payment } = makeDb();
  link.sms_receipts_enabled = true;
  const event = { object_id: 'pay-test-receive', object_type: 'payment', event_type: 'payment.processing_completed' };
  const providerObject = {
    id: 'pay-test-receive',
    status: 'completed',
    financialAccountId: payment.provider_account_id,
    amount: { currency: 'SLE', value: 2500 },
    reference: payment.reference,
    metadata: { mmReceivePayId: payment.id }
  };
  await reconcileReceivePaymentEvent(db, event, providerObject);
  assert.equal(payment.state, 'completed');
  assert.equal(db.tables.matmove_receive_sms_outbox.length, 1);
  assert.equal(db.tables.matmove_receive_sms_outbox[0].phone_e164, '+23276543210');
  assert.match(db.tables.matmove_receive_sms_outbox[0].message, /SLE 25\.00/);
  await reconcileReceivePaymentEvent(db, event, providerObject);
  assert.equal(db.tables.matmove_receive_sms_outbox.length, 1);
});

test('incoming payment amount mismatch is rejected without completing the MatMove record', async () => {
  const { db, payment } = makeDb();
  const event = { object_id: 'pay-test-receive', object_type: 'payment', event_type: 'payment.processing_completed' };
  const providerObject = {
    id: 'pmc-test-receive',
    status: 'completed',
    financialAccountId: payment.provider_account_id,
    amount: { currency: 'SLE', value: 2501 },
    reference: payment.reference,
    metadata: { mmReceivePayId: payment.id }
  };
  await assert.rejects(reconcileReceivePaymentEvent(db, event, providerObject), /did not match/i);
  assert.equal(payment.state, 'processing');
});

test('SMS receipt worker stays idle until its provider credentials are configured', async () => {
  const keys = ['APPHIVE_SMS_CLIENT_ID', 'APPHIVE_SMS_CLIENT_SECRET', 'APPHIVE_SMS_WALLET_TOKEN', 'APPHIVE_SMS_SENDER_ID'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  let queries = 0;
  const db = { from() { queries++; throw new Error('must not query an unconfigured outbox'); } };
  try {
    const result = await processReceiveSmsOutbox({ db });
    assert.equal(result.configured, false);
    assert.equal(queries, 0);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('Monime receive flow has unique pages, three validation stages and a UVAN-targeted collect_payment template', async () => {
  const flow = JSON.parse(await readFile(new URL('../MATMOVE_RECEIVE_MONEY_USSD_FLOW.json', import.meta.url), 'utf8'));
  assert.equal(flow.version, '1.0');
  const ids = flow.pages.map(page => page.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes('enter_recipient'));
  assert.ok(ids.includes('enter_amount'));
  assert.ok(ids.includes('confirm_payment'));
  const paymentPage = flow.pages.find(page => page.id === 'collect_payment');
  assert.equal(paymentPage.component.template_name, 'collect_payment');
  assert.equal(paymentPage.component.template_data.payment_target_ref, '$(data.paymentTargetRef)');
  assert.equal(paymentPage.component.template_data.metadata.mmReceivePayId, '$(data.receivePaymentId)');
});

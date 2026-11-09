import test from 'node:test';
import assert from 'node:assert/strict';
import { processMonimeWebhookBatch } from '../server/monime-webhook-worker.js';

const paymentId = '00000000-0000-4000-8000-000000000123';
const secretValues = ['MONIME_API_KEY', 'MONIME_SPACE_ID'];

function fixture(status = 'completed', signatureVerified = true) {
  const event = {
    event_id: 'wke-worker-test',
    event_type: 'internal_transfer.completed',
    payload: {
      event: { id: 'wke-worker-test', name: 'internal_transfer.completed' },
      object: { id: 'itr-worker-test', type: 'internal_transfer' },
      data: {}
    },
    attempts: 0,
    status: 'pending',
    updated_at: new Date().toISOString(),
    received_at: new Date().toISOString(),
    signature_verified: signatureVerified,
    last_error: null
  };
  const payment = {
    id: paymentId,
    purchase_type: 'event',
    currency: 'SLE',
    amount_minor: 2500,
    source_account_id: 'fac-customer',
    destination_account_id: 'fac-events',
    provider_transfer_id: null,
    fulfilled_at: null,
    state: 'processing'
  };
  const transfer = {
    id: 'itr-worker-test',
    status,
    amount: { currency: 'SLE', value: 2500 },
    sourceFinancialAccount: { id: 'fac-customer' },
    destinationFinancialAccount: { id: 'fac-events' },
    metadata: { matmovePurchasePaymentId: paymentId }
  };

  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.values = null;
      this.columns = '*';
      this.sort = null;
      this.maxRows = null;
    }
    select(columns = '*') { this.columns = columns; return this; }
    eq(key, value) { this.filters.push(['eq', key, value]); return this; }
    lt(key, value) { this.filters.push(['lt', key, value]); return this; }
    order(key, options = {}) { this.sort = [key, options.ascending !== false]; return this; }
    limit(value) { this.maxRows = value; return this; }
    update(values) { this.values = values; return this; }
    rows() {
      const source = this.table === 'matmove_monime_webhook_events'
        ? [event]
        : this.table === 'matmove_purchase_payments'
          ? [payment]
          : [];
      let rows = source.filter(row => this.filters.every(([op, key, value]) => {
        if (op === 'eq') return row[key] === value;
        return String(row[key]) < String(value);
      }));
      if (this.sort) {
        const [key, ascending] = this.sort;
        rows = rows.sort((a, b) => String(a[key]).localeCompare(String(b[key])) * (ascending ? 1 : -1));
      }
      if (this.maxRows !== null) rows = rows.slice(0, this.maxRows);
      return rows;
    }
    project(row) {
      if (!row) return null;
      if (this.columns === '*' || this.columns === undefined) return { ...row };
      return Object.fromEntries(this.columns.split(',').map(key => [key, row[key]]));
    }
    async execute(single = false) {
      const rows = this.rows();
      if (this.values) {
        for (const row of rows) Object.assign(row, this.values);
        return { data: single ? this.project(rows[0]) : null, error: null };
      }
      return { data: single ? this.project(rows[0]) : rows.map(row => this.project(row)), error: null };
    }
    maybeSingle() { return this.execute(true); }
    single() { return this.execute(true); }
    then(resolve, reject) { return this.execute(false).then(resolve, reject); }
  }

  const db = {
    from: table => new Query(table),
    async rpc(name, args) {
      assert.equal(name, 'matmove_fulfill_purchase_payment');
      assert.equal(args.p_payment_id, paymentId);
      payment.fulfilled_at = new Date().toISOString();
      return { data: { success: true }, error: null };
    }
  };

  return { event, payment, transfer, db };
}

async function withProvider(t, transfer, run) {
  const previousEnv = Object.fromEntries(secretValues.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  process.env.MONIME_API_KEY = 'mon_test_matmove_worker_test';
  process.env.MONIME_SPACE_ID = 'space-test';
  globalThis.fetch = async (url, options) => {
    fetchCalls++;
    assert.match(String(url), /\/v1\/internal-transfers\/itr-worker-test$/);
    assert.equal(options.method, 'GET');
    return {
      ok: true,
      status: 200,
      json: async () => ({ result: structuredClone(transfer) })
    };
  };

  try {
    await run(() => fetchCalls);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('worker fulfils a purchase only after an authoritative completed transfer matches', async t => {
  const { event, payment, transfer, db } = fixture('completed', true);
  await withProvider(t, transfer, async fetchCount => {
    const result = await processMonimeWebhookBatch({ db, limit: 10 });
    assert.deepEqual(result, { checked: 1, processed: 1, retrying: 0, failed: 0 });
    assert.equal(fetchCount(), 1);
    assert.equal(payment.state, 'completed');
    assert.ok(payment.fulfilled_at);
    assert.equal(payment.provider_transfer_id, transfer.id);
    assert.equal(event.status, 'processed');
    assert.equal(event.attempts, 1);
    assert.equal(event.signature_verified, true);
  });
});

test('worker keeps a pending provider transfer pending and does not fulfil it', async t => {
  const { event, payment, transfer, db } = fixture('processing', true);
  await withProvider(t, transfer, async fetchCount => {
    const result = await processMonimeWebhookBatch({ db, limit: 10 });
    assert.deepEqual(result, { checked: 1, processed: 0, retrying: 1, failed: 0 });
    assert.equal(fetchCount(), 1);
    assert.equal(payment.state, 'processing');
    assert.equal(payment.fulfilled_at, null);
    assert.equal(event.status, 'pending');
    assert.match(event.last_error, /not final/i);
  });
});

test('worker rejects unsigned inbox content before querying Monime', async () => {
  const { event, payment, transfer, db } = fixture('completed', false);
  const originalFetch = globalThis.fetch;
  const previousApiKey = process.env.MONIME_API_KEY;
  const previousSpace = process.env.MONIME_SPACE_ID;
  process.env.MONIME_API_KEY = 'mon_test_matmove_worker_test';
  process.env.MONIME_SPACE_ID = 'space-test';
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls++; throw new Error('must not call Monime'); };

  try {
    const result = await processMonimeWebhookBatch({ db, limit: 10 });
    assert.deepEqual(result, { checked: 1, processed: 0, retrying: 1, failed: 0 });
    assert.equal(fetchCalls, 0);
    assert.equal(payment.fulfilled_at, null);
    assert.equal(event.status, 'pending');
    assert.match(event.last_error, /not verified/i);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousApiKey === undefined) delete process.env.MONIME_API_KEY;
    else process.env.MONIME_API_KEY = previousApiKey;
    if (previousSpace === undefined) delete process.env.MONIME_SPACE_ID;
    else process.env.MONIME_SPACE_ID = previousSpace;
  }
});

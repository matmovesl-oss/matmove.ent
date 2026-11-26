import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { liveWallet } from '../server/live-wallet.js';
import { isWithinDateRange, localDateKey } from '../shared/activity-date-range.js';

const SLE_WALLET = [{
  id: 'wallet-sle',
  user_id: 'customer-1',
  currency: 'SLE',
  monime_account_id: 'fac-customer-1-sle',
  balance: 0,
}];

const account = (currency, uvan) => ({
  id: `fac-customer-1-${currency.toLowerCase()}`,
  uvan,
  currency,
  balance: { available: { currency, value: 12500 } },
});

test('SLE wallet exposes the Monime-provided UVAN and Get Paid URL without deriving it from the account ID', async () => {
  const result = await liveWallet(
    { wallets: SLE_WALLET, user: { id: 'customer-1' } },
    {
      verify: async () => account('SLE', '027027550'),
      provider: async () => [],
    },
  );

  assert.equal(result.sleWallet.monime_account_id, 'fac-customer-1-sle');
  assert.equal(result.sleWallet.monime_uvan, '027027550');
  assert.equal(result.sleWallet.monime_payment_url, 'https://pay.monime.io/027027550');
  assert.ok(!result.sleWallet.monime_payment_url.includes('fac-customer-1-sle'));
});

test('SLE Get Paid link is omitted when Monime does not return a valid UVAN', async () => {
  for (const uvan of [undefined, null, '', 'fac-customer-1', '02702/7550', '0270275500000000000000000']) {
    const result = await liveWallet(
      { wallets: SLE_WALLET, user: { id: 'customer-1' } },
      {
        verify: async () => account('SLE', uvan),
        provider: async () => [],
      },
    );

    assert.equal(result.sleWallet.monime_uvan, undefined);
    assert.equal(result.sleWallet.monime_payment_url, undefined);
  }
});

test('USD wallet does not show the SLE mobile-money Get Paid URL', async () => {
  const result = await liveWallet(
    {
      wallets: [{
        id: 'wallet-usd',
        user_id: 'customer-1',
        currency: 'USD',
        monime_account_id: 'fac-customer-1-usd',
      }],
      user: { id: 'customer-1' },
    },
    {
      verify: async () => account('USD', '027027550'),
      provider: async () => [],
    },
  );

  assert.equal(result.usdWallet.monime_uvan, '027027550');
  assert.equal(result.usdWallet.monime_payment_url, undefined);
});

test('Wallet Cards keeps provider identifiers off the card and opens a role-branded Get paid panel', async () => {
  const source = await readFile(new URL('../src/components/WalletCards.tsx', import.meta.url), 'utf8');
  const panel = await readFile(new URL('../src/components/ReceiveMoneyPanel.tsx', import.meta.url), 'utf8');

  assert.match(source, /Get paid/);
  assert.match(source, /setGetPaidOpen\(true\)/);
  assert.match(source, /role=\{role\}/);
  assert.doesNotMatch(source, /Monime UVAN|monime_uvan|pay\.monime\.io|Account ID:/);
  assert.doesNotMatch(source, /wallet\?\.monime_payment_url/);
  assert.match(panel, /MatMove Rider Get Paid/);
  assert.match(panel, /MatMove Driver Get Paid/);
  assert.match(panel, /MatMove Merchant Get Paid/);
  assert.match(panel, /role="dialog"/);
  assert.match(panel, /Copy link/);
  assert.match(panel, /Share details/);
  assert.ok(panel.includes('sleWallet?.monime_uvan'));
  assert.ok(panel.includes('https://pay.monime.io/'));
  assert.match(panel, /MatMove Get Paid/);
  assert.match(panel, /Copy UVAN/);
  assert.match(panel, /Share payment link/);
  assert.doesNotMatch(panel, /Open Monime/);
  assert.match(panel, /direct Monime Get Paid link is ready above/);
});

test('Get Paid link is delivered through the existing wallet API; the twelve-route limit remains unchanged', async () => {
  const api = await readdir(new URL('../api/', import.meta.url));
  const source = await readFile(new URL('../api/get-live-wallet.js', import.meta.url), 'utf8');

  assert.equal(api.length, 12);
  assert.match(source, /protectedWallet\('read'/);
  assert.match(source, /liveWallet\(req\.matmove\)/);
});


test('Activity date filtering is inclusive and handles one-sided ranges', () => {
  assert.equal(localDateKey('2026-11-26T12:00:00.000Z'), '2026-11-26');
  assert.equal(isWithinDateRange('2026-11-20T08:00:00.000Z', '2026-11-20', '2026-11-26'), true);
  assert.equal(isWithinDateRange('2026-11-26T23:59:59.000Z', '2026-11-20', '2026-11-26'), true);
  assert.equal(isWithinDateRange('2026-11-19T23:59:59.000Z', '2026-11-20', '2026-11-26'), false);
  assert.equal(isWithinDateRange('2026-11-27T00:00:00.000Z', '2026-11-20', '2026-11-26'), false);
  assert.equal(isWithinDateRange('2026-11-27T00:00:00.000Z', '2026-11-20', ''), true);
  assert.equal(isWithinDateRange('2026-11-19T00:00:00.000Z', '', '2026-11-20'), true);
  assert.equal(isWithinDateRange('not-a-date', '2026-11-20', ''), false);
  assert.equal(isWithinDateRange('not-a-date'), true);
});

test('MatMove Get Paid UVAN panel keeps only the three useful actions and uses MatMove branding', async () => {
  const source = await readFile(new URL('../src/components/ReceiveMoneyPanel.tsx', import.meta.url), 'utf8');
  assert.match(source, /MatMove Get Paid/);
  assert.match(source, /Copy UVAN/);
  assert.match(source, /Copy link/);
  assert.match(source, /Share payment link/);
  assert.doesNotMatch(source, /Open Monime/);
});

test('account navigation renders the saved account identity photo instead of a permanent static icon', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const profile = await readFile(new URL('../src/components/AccountProfile.tsx', import.meta.url), 'utf8');
  assert.match(app, /AccountIdentity = lazy/);
  assert.match(app, /<AccountIdentity[\s\S]*?userId=\{profile\.id\}/);
  assert.match(profile, /export function AccountIdentity/);
  assert.match(profile, /<Photo url=\{photoUrl\}/);
});

test('trip and transaction history both expose shared calendar date-range filtering', async () => {
  const [trips, transactions, filter] = await Promise.all([
    readFile(new URL('../src/components/TripHistory.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/TransactionHistory.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/HistoryDateFilter.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(trips, /HistoryDateFilter/);
  assert.match(trips, /isWithinDateRange\(t\.created_at/);
  assert.match(transactions, /HistoryDateFilter/);
  assert.match(transactions, /isWithinDateRange/);
  assert.match(filter, /type="date"/);
  assert.match(filter, /Last 7 days/);
  assert.match(filter, /Last 30 days/);
});

test('Monime transaction history follows cursor pages and deduplicates overlapping records', async () => {
  const calls = [];
  const tx = (id, createdAt) => ({
    id,
    amount: { currency: 'SLE', value: 1000 },
    createTime: createdAt,
  });
  const pages = [
    {
      result: [tx('trn-first', '2026-10-01T10:00:00Z')],
      pagination: { next: 'cursor-2' },
    },
    {
      result: [tx('trn-second', '2026-10-02T10:00:00Z'), tx('trn-first', '2026-10-01T10:00:00Z')],
      pagination: { next: null },
    },
  ];

  const result = await liveWallet(
    { wallets: SLE_WALLET, user: { id: 'customer-1' } },
    {
      verify: async () => account('SLE', '027027550'),
      provider: async (path, options) => {
        calls.push({ path, options });
        return pages.shift();
      },
    },
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.includePagination, true);
  assert.match(calls[0].path, /limit=50/);
  assert.match(calls[1].path, /after=cursor-2/);
  assert.deepEqual(result.transactions.map(tx => tx.id), ['trn-second', 'trn-first']);
});

test('Monime transaction history stops at the safety page cap and reports that older records may remain', async () => {
  let calls = 0;
  const result = await liveWallet(
    { wallets: SLE_WALLET, user: { id: 'customer-1' } },
    {
      verify: async () => account('SLE', '027027550'),
      provider: async () => {
        calls += 1;
        return { result: [], pagination: { next: 'cursor-' + calls } };
      },
    },
  );

  assert.equal(calls, 20);
  assert.ok(result.warnings.some(warning => warning.includes('latest 1000 records')));
});

test('date-filtered transactions show every matching record rather than the five-row recent preview', async () => {
  const source = await readFile(new URL('../src/components/TransactionHistory.tsx', import.meta.url), 'utf8');
  assert.match(source, /const dateFilterActive = Boolean\(dateFrom \|\| dateTo\)/);
  assert.match(source, /recent && !dateFilterActive \? dateRows\.slice\(0, 5\) : dateRows/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = new URL('../server/cash-ride-payments.js', import.meta.url);

test('cash transfer creation persists provider ID before independent current-object lookup', async () => {
  const code = await readFile(source, 'utf8');
  const post = code.indexOf("created = await provider('internal-transfers'");
  const persist = code.indexOf("await recordLeg(db, bookingId, kind, { id: created.id }, 'pending')");
  const lookup = code.indexOf("transfer = await provider(`internal-transfers/${encodeURIComponent(created.id)}`)");
  assert.ok(post >= 0);
  assert.ok(persist > post, 'provider ID must be durably recorded after POST');
  assert.ok(lookup > persist, 'current provider object must be fetched after ID is stored');
  assert.match(code.slice(lookup, lookup + 2200), /transferMatches\(transfer, expectedLeg\)/);
});

test('cash worker never posts again when current-object lookup is unavailable', async () => {
  const code = await readFile(source, 'utf8');
  const lookup = code.indexOf("transfer = await provider(`internal-transfers/${encodeURIComponent(created.id)}`)");
  const catchStart = code.indexOf("} catch (error) {", lookup);
  const catchEnd = code.indexOf("\n    }", catchStart + 1);
  const catchBody = code.slice(catchStart, catchEnd);
  assert.match(catchBody, /return \{ \.\.\.expectedLeg, status: 'pending' \}/);
  assert.doesNotMatch(catchBody, /provider\('internal-transfers',\s*\{/);
});

test('cash worker treats provider POST response as an ID only, not settlement evidence', async () => {
  const code = await readFile(source, 'utf8');
  const postBranch = code.slice(
    code.indexOf("created = await provider('internal-transfers'"),
    code.indexOf("\n  } else {", code.indexOf("created = await provider('internal-transfers'"))
  );
  assert.match(postBranch, /created\.id/);
  assert.match(postBranch, /await recordLeg\(db, bookingId, kind, \{ id: created\.id \}, 'pending'\)/);
  assert.doesNotMatch(postBranch, /recordLeg\(db, bookingId, kind, created, created\.status/);
});


test('cash availability is advertised only after both configured SLE platform accounts are read from Monime', async () => {
  const code = await readFile(source, 'utf8');
  const config = code.slice(code.indexOf("if (action === 'cash_config')"), code.indexOf("const bookingId = req.body?.bookingId"));
  assert.match(config, /readSettings\(db, \{ requireEnabled: false \} \)/);
  assert.match(config, /financial-accounts\/\$\{encodeURIComponent\(settings\.fee_hold_account_id\)\}/);
  assert.match(config, /financial-accounts\/\$\{encodeURIComponent\(settings\.fee_revenue_account_id\)\}/);
  assert.match(config, /providerAccountBalance\(holdAccount, settings\.fee_hold_account_id\)/);
  assert.match(config, /providerAccountBalance\(revenueAccount, settings\.fee_revenue_account_id\)/);
  assert.match(config, /enabled: settings\.enabled === true/);\n  assert.match(config, /accountsVerified: true/);
});


test('cash settlement fee destination must match the shared platform fee environment account', async () => {
  const code = await readFile(source, 'utf8');
  const settings = code.slice(code.indexOf('async function readSettings'), code.indexOf('function providerAccountBalance'));
  assert.match(settings, /process\.env\.MONIME_PLATFORM_FEE_ACCOUNT_ID/);
  assert.match(settings, /data\.fee_revenue_account_id !== platformFeeAccountId/);
  assert.match(settings, /data\.fee_hold_account_id === platformFeeAccountId/);
  assert.match(settings, /CASH_NOT_CONFIGURED/);
});

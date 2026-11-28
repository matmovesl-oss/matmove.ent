import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('transaction receipt helper builds the MatMove-branded PDF from ledger data', async () => {
  const helper = await read('../src/lib/pdfReceipt.ts');
  assert.match(helper, /export async function shareTransactionReceiptPdf/);
  assert.match(helper, /shareReceiptPdf\(/);
  assert.match(helper, /MatMove Transaction Receipt/);
  assert.match(helper, /Transaction reference/);
  assert.match(helper, /transactionAmount\(tx\)/);
  assert.match(helper, /logo\.jpg/);
});

test('transaction history and details both share the PDF helper', async () => {
  const history = await read('../src/components/TransactionHistory.tsx');
  const modal = await read('../src/components/TransactionModal.tsx');
  assert.match(history, /shareTransactionReceiptPdf\(tx\)/);
  assert.match(modal, /shareTransactionReceiptPdf\(tx\)/);
  assert.match(modal, /Share PDF receipt/);
});

test('MatMove receipt logo asset is present in the public app bundle', async () => {
  await access(new URL('../public/logo.jpg', import.meta.url));
});

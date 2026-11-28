import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('wallet transaction share actions generate and share the branded MatMove PDF', async () => {
  const [history, modal, receipt, packageJson] = await Promise.all([
    readFile('src/components/TransactionHistory.tsx', 'utf8'),
    readFile('src/components/TransactionModal.tsx', 'utf8'),
    readFile('src/lib/pdfReceipt.ts', 'utf8'),
    readFile('package.json', 'utf8'),
  ]);

  for (const source of [history, modal]) {
    assert.match(source, /shareTransactionReceiptPdf/);
    assert.match(source, /Branded MatMove PDF receipt/);
    assert.doesNotMatch(source, /transactionReceipt\(tx\)/);
  }

  assert.match(receipt, /fetch\(`\$\{baseUrl\}logo\.jpg`/);
  assert.match(receipt, /\/Subtype \/Image/);
  assert.match(receipt, /navigator\.share/);
  assert.match(receipt, /files: \[file\]/);
  assert.match(receipt, /link\.download = filename/);
  assert.match(receipt, /Official wallet transaction record/);

  const scripts = JSON.parse(packageJson).scripts;
  assert.match(scripts.build, /customer-transaction-pdf-sharing\.test\.mjs/);
  assert.match(scripts['test:release'], /customer-transaction-pdf-sharing\.test\.mjs/);
});

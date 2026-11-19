import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('receipt and payout dialogs keep close controls compact at narrow mobile widths', async () => {
  const payout = await readFile(new URL('../src/components/PayoutPanel.tsx', import.meta.url), 'utf8');
  const receipt = await readFile(new URL('../src/components/TransactionModal.tsx', import.meta.url), 'utf8');
  const topup = await readFile(new URL('../src/components/WalletTopUp.tsx', import.meta.url), 'utf8');
  assert.match(payout, /shrink-0 whitespace-nowrap rounded-lg border px-3 py-2/);
  assert.match(payout, /max-h-\[calc\(100dvh-1rem\)\].*overscroll-contain/);
  assert.match(receipt, /h-10 w-10 shrink-0 items-center justify-center/);
  assert.match(receipt, /max-h-\[calc\(100dvh-1rem\)\].*overscroll-contain/);
  assert.match(topup, /h-10 w-10 shrink-0 items-center justify-center/);
});

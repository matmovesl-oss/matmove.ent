import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCashRideSplit, moneyToMinor } from '../shared/cash-payment-rules.js';

test('SLE 100 cash ride conserves fare as SLE 85 driver cash plus SLE 15 MatMove fee', () => {
  const split = calculateCashRideSplit('100.00');
  assert.equal(split.fareMinor, 10000);
  assert.equal(split.driverCashMinor, 8500);
  assert.equal(split.matmoveFeeMinor, 1500);
  assert.equal(split.driverCashMinor + split.matmoveFeeMinor, split.fareMinor);
});

test('cent rounding keeps every minor unit accounted for', () => {
  const split = calculateCashRideSplit('12.35');
  assert.equal(split.driverCashMinor + split.matmoveFeeMinor, 1235);
  assert.equal(split.driverCashMinor, 1050);
  assert.equal(split.matmoveFeeMinor, 185);
});

test('money conversion rejects malformed, negative and excessive fares', () => {
  for (const value of ['0', '-1', '1.234', 'abc', '1000001', '']) {
    assert.throws(() => moneyToMinor(value));
  }
});

test('calculation is deterministic and returns a frozen result', () => {
  const a = calculateCashRideSplit('99.99');
  const b = calculateCashRideSplit('99.99');
  assert.deepEqual(a, b);
  assert.equal(Object.isFrozen(a), true);
});

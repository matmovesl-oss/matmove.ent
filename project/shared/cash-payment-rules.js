const MAX_FARE_MINOR = 100_000_000; // SLE 1,000,000.00
const MONEY = /^\d{1,7}(?:\.\d{1,2})?$/;

export function moneyToMinor(value) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new TypeError('Enter a valid SLE amount.');
  }
  const text = String(value).trim();
  if (!MONEY.test(text)) throw new RangeError('Use up to two decimal places.');
  const [whole, fraction = ''] = text.split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(minor) || minor < 1 || minor > MAX_FARE_MINOR) {
    throw new RangeError('Fare is outside the permitted range.');
  }
  return minor;
}

export function calculateCashRideSplit(fare) {
  const fareMinor = moneyToMinor(fare);
  const driverMinor = Math.round(fareMinor * 0.85);
  const matmoveFeeMinor = fareMinor - driverMinor;
  return Object.freeze({
    currency: 'SLE',
    fareMinor,
    driverCashMinor: driverMinor,
    matmoveFeeMinor,
    fare: fareMinor / 100,
    driverCash: driverMinor / 100,
    matmoveFee: matmoveFeeMinor / 100,
  });
}

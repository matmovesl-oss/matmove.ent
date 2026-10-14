
export const SPIN_ENTRY_MINOR = 500;
export const SPIN_COUNT = 3;
export const SPIN_PRIZES = [100, 500, 1000, 1500, 2000];

// Every visible sector has exactly the same chance. No wallet-based odds.
export function validateSpinSectors(sectors) {
  if (!Array.isArray(sectors) || sectors.length < 5 || sectors.length > 120) {
    throw new Error('Use between 5 and 120 wheel numbers.');
  }
  const labels = new Set();
  for (const sector of sectors) {
    if (!sector || typeof sector.digit !== 'string' || !/^\d{1,3}$/.test(sector.digit) ||
        labels.has(sector.digit) || !SPIN_PRIZES.includes(sector.prizeMinor)) {
      throw new Error('Use unique numeric labels and prizes of SLE 1, 5, 10, 15 or 20.');
    }
    labels.add(sector.digit);
  }
  if (SPIN_PRIZES.some(prize => !sectors.some(sector => sector.prizeMinor === prize))) {
    throw new Error('All five advertised prizes must appear on the wheel.');
  }
  return sectors.map(({digit, prizeMinor}) => ({digit, prizeMinor}));
}

export function spinOdds(sectors) {
  const clean = validateSpinSectors(sectors);
  return SPIN_PRIZES.map(prizeMinor => ({
    prizeMinor,
    sectors: clean.filter(s => s.prizeMinor === prizeMinor).length,
    totalSectors: clean.length,
    probability: clean.filter(s => s.prizeMinor === prizeMinor).length / clean.length,
  }));
}

export function spinEconomics(sectors) {
  const clean = validateSpinSectors(sectors);
  const expectedPrizeMinor = clean.reduce((sum, s) => sum + s.prizeMinor, 0) / clean.length;
  return {
    expectedPrizeMinor,
    expectedRoundPrizeMinor: expectedPrizeMinor * SPIN_COUNT,
    expectedMarginMinor: SPIN_ENTRY_MINOR - expectedPrizeMinor * SPIN_COUNT,
    maximumRoundPrizeMinor: Math.max(...clean.map(s => s.prizeMinor)) * SPIN_COUNT,
  };
}

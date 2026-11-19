import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  assertRideVehicleCompatibility,
  normalizeMatMoveVehicleType,
} from '../server/vehicle-compatibility.js';

test('normalizes every approved MatMove vehicle category and its onboarding label', () => {
  assert.equal(normalizeMatMoveVehicleType('Motorbike (Okada)'), 'bike');
  assert.equal(normalizeMatMoveVehicleType('bike'), 'bike');
  assert.equal(normalizeMatMoveVehicleType('Tricycle (Keke)'), 'keke');
  assert.equal(normalizeMatMoveVehicleType('keke'), 'keke');
  assert.equal(normalizeMatMoveVehicleType('Kekeh'), 'keke');
  assert.equal(normalizeMatMoveVehicleType('Car'), 'car');
  assert.equal(normalizeMatMoveVehicleType('SUV'), 'car');
  assert.equal(normalizeMatMoveVehicleType('Van / Truck'), 'van');
  assert.equal(normalizeMatMoveVehicleType('minibus'), 'van');
});

test('accepts only the same requested and registered vehicle category', () => {
  assert.equal(
    assertRideVehicleCompatibility(
      { vehicle_type: 'bike' },
      { vehicle_type: 'Motorbike (Okada)' }
    ),
    'bike'
  );
  assert.throws(
    () => assertRideVehicleCompatibility(
      { vehicle_type: 'car' },
      { vehicle_type: 'Tricycle (Keke)' }
    ),
    /request requires a car vehicle/i
  );
});

test('fails closed when either side has no verified vehicle category', () => {
  assert.throws(
    () => assertRideVehicleCompatibility({ vehicle_type: null }, { vehicle_type: 'Car' }),
    /no verified vehicle category/i
  );
  assert.throws(
    () => assertRideVehicleCompatibility({ vehicle_type: 'car' }, {}),
    /vehicle type is missing or unverified/i
  );
});

test('digital and cash ride acceptance both use the shared server guard', async () => {
  const [digital, cash, driver] = await Promise.all([
    readFile(new URL('../server/ride-payments.js', import.meta.url), 'utf8'),
    readFile(new URL('../server/cash-ride-payments.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/DriverDashboard.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(digital, /assertRideVehicleCompatibility\(booking, profile\)/);
  assert.match(cash, /assertRideVehicleCompatibility\(booking, profile\)/);
  assert.match(cash, /vehicle_type/);
  assert.match(driver, /const vehicleBlockReason =/);
  assert.match(driver, /vehicleBlockReason\(r\)/);
});

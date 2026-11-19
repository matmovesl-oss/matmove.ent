import { HttpError } from './wallet-security.js';

const labels = {
  bike: 'motorbike (Okada)',
  keke: 'tricycle (Keke)',
  car: 'car',
  van: 'van / truck',
};

export function normalizeMatMoveVehicleType(value) {
  const type = String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  if (/motorbike|motorcycle|okada|\bbike\b/.test(type)) return 'bike';
  if (/tricycle|\bkeke\b/.test(type)) return 'keke';
  if (/van|truck|minibus/.test(type)) return 'van';
  if (/\bcar\b|sedan|saloon|suv/.test(type)) return 'car';
  return null;
}

export function assertRideVehicleCompatibility(booking, profile) {
  const requested = normalizeMatMoveVehicleType(booking?.vehicle_type);
  const registered = normalizeMatMoveVehicleType(
    profile?.vehicle_type ||
    profile?.vehicleType ||
    profile?.details?.vehicleType ||
    profile?.metadata?.vehicle_type
  );

  if (!requested) {
    throw new HttpError(
      409,
      'This request has no verified vehicle category. It must be reviewed before a driver can accept it.'
    );
  }

  if (!registered) {
    throw new HttpError(
      409,
      'Your registered vehicle type is missing or unverified. Update your driver vehicle details before accepting requests.'
    );
  }

  if (requested !== registered) {
    throw new HttpError(
      409,
      `This request requires a ${labels[requested]} vehicle. Your registered vehicle is ${labels[registered]}.`
    );
  }

  return requested;
}

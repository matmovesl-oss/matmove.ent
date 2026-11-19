import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const migration=await readFile(new URL('../supabase/migrations/20261119120000_matmove_hybrid_vehicle_fallback_v1.sql',import.meta.url),'utf8');
const service=await readFile(new URL('../src/services/fareNegotiationService.ts',import.meta.url),'utf8');
const ui=await readFile(new URL('../src/components/FareNegotiation.tsx',import.meta.url),'utf8');
const driver=await readFile(new URL('../src/pages/DriverDashboard.tsx',import.meta.url),'utf8');
const rider=await readFile(new URL('../src/pages/RiderDashboard.tsx',import.meta.url),'utf8');

test('fare offers snapshot only the KYC-approved driver vehicle and enforce strict category matching',()=>{
 assert.match(migration,/select \* into p from public\.profiles where id=new\.driver_id/i);
 assert.match(migration,/p\.kyc_status::text<>'approved'/);
 assert.match(migration,/p\.vehicle_type/);
 assert.match(migration,/Only the requested verified vehicle category can offer/);
 assert.doesNotMatch(migration,/created_at\+interval '2 minutes'/);
 assert.match(migration,/new\.vehicle_type:=p\.vehicle_type/);
});

test('customer approval records the selected vehicle and payment must use that category',()=>{
 assert.match(migration,/matmove_confirmed_vehicle_type/);
 assert.match(migration,/new\.status='accepted'/);
 assert.match(migration,/INVALID_VEHICLE/);
 assert.match(migration,/before insert on public\.ride_payments/);
});


test('fare read RPC binds the supplied identity to the authenticated session and limits booking access',()=>{
 assert.match(migration,/v_actor uuid := auth\.uid\(\)/);
 assert.match(migration,/p_user_id is distinct from v_actor/);
 assert.match(migration,/v_owner:=b\.rider_id is not distinct from v_actor/);
 assert.match(migration,/Request access denied/);
});

test('fare read payload includes requested and offered vehicle details with strict client validation',()=>{
 assert.match(migration,/'requestedVehicleType',b\.vehicle_type/);
 assert.match(migration,/'vehicleType',coalesce\(o\.vehicle_type/);
 assert.match(service,/requestedVehicleType/);
 assert.match(service,/o\.vehicleType/);
});

test('customer approval records category and fare together; mismatched drivers are blocked in UI',()=>{
 assert.match(ui,/Approve <b>\{confirm\.vehicleType\}<\/b>/);
 assert.match(ui,/confirms both the vehicle category and total fare/);
 assert.match(ui,/Alternative categories stay unavailable until MatMove can verify/);
 assert.match(ui,/!!vehicleType&&matchingVehicle/);
 assert.match(driver,/vehicleType=\{profile\.vehicle_type \|\| ''\}/);
});


test('rider and merchant see actual driver vehicle separately from requested category',()=>{
 assert.match(rider,/Driver vehicle: \{String\(activeBooking\.matmove_confirmed_vehicle_type\|\|activeBooking\.driver\?\.vehicle_type\|\|'Awaiting vehicle verification'\)/);
 assert.match(rider,/Requested vehicle: \{String\(activeBooking\.vehicle_type/);
 assert.match(merchant,/Driver vehicle: \\{String\\(activeBooking\\.matmove_confirmed_vehicle_type\\|\\|activeBooking\\.driver\\?\\.vehicle_type\\|\\|'Awaiting vehicle verification'\\)/);
 assert.match(merchant,/Requested vehicle: \\{String\\(activeBooking\\.vehicle_type/);
 assert.doesNotMatch(rider,/Driver vehicle: \{String\(activeBooking\.matmove_confirmed_vehicle_type\|\|activeBooking\.driver\?\.vehicle_type\|\|activeBooking\.vehicle_type/);
});

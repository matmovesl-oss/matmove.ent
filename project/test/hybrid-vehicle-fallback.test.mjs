import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const migration=await readFile(new URL('../supabase/migrations/20261119120000_matmove_hybrid_vehicle_fallback_v1.sql',import.meta.url),'utf8');
const service=await readFile(new URL('../src/services/fareNegotiationService.ts',import.meta.url),'utf8');
const ui=await readFile(new URL('../src/components/FareNegotiation.tsx',import.meta.url),'utf8');
const driver=await readFile(new URL('../src/pages/DriverDashboard.tsx',import.meta.url),'utf8');

test('alternative vehicle offers snapshot only the KYC-approved driver vehicle and wait two minutes for a category mismatch',()=>{
 assert.match(migration,/select \* into p from public\.profiles where id=new\.driver_id/i);
 assert.match(migration,/p\.kyc_status::text<>'approved'/);
 assert.match(migration,/p\.vehicle_type/);
 assert.match(migration,/b\.created_at\+interval '2 minutes'/);
 assert.match(migration,/new\.vehicle_type:=p\.vehicle_type/);
});

test('customer approval records the selected vehicle and payment must use that category',()=>{
 assert.match(migration,/matmove_confirmed_vehicle_type/);
 assert.match(migration,/new\.status='accepted'/);
 assert.match(migration,/INVALID_VEHICLE/);
 assert.match(migration,/before insert on public\.ride_payments/);
});

test('fare read payload includes requested and offered vehicle details with strict client validation',()=>{
 assert.match(migration,/'requestedVehicleType',b\.vehicle_type/);
 assert.match(migration,/'vehicleType',o\.vehicle_type/);
 assert.match(service,/requestedVehicleType/);
 assert.match(service,/o\.vehicleType/);
});

test('customer sees alternative vehicle and confirms category and fare together',()=>{
 assert.match(ui,/Approve <b>\{confirm\.vehicleType\}<\/b>/);
 assert.match(ui,/confirms both the vehicle category and total fare/);
 assert.match(ui,/Alternative vehicle/);
 assert.match(driver,/vehicleType=\{profile\.vehicle_type \|\| ''\}/);
});

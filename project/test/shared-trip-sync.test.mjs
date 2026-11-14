import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('Rider and Merchant active trip state restores on foreground, focus, pageshow and network reconnect',async()=>{
 const hook=await read('../src/lib/useRideNegotiation.ts');
 assert.match(hook,/attachTripContacts\(owned\)/);
 assert.match(hook,/document\.addEventListener\('visibilitychange'/);
 assert.match(hook,/window\.addEventListener\('focus'/);
 assert.match(hook,/window\.addEventListener\('pageshow'/);
 assert.match(hook,/window\.addEventListener\('online'/);
 assert.match(hook,/setInterval\(\(\) => \{ if \(document\.visibilityState === 'visible'\) void refresh\(\); \}, 5000\)/);
});

test('Driver radar restores assigned rides on foreground and resolves rider contact cards',async()=>{
 const driver=await read('../src/pages/DriverDashboard.tsx');
 assert.match(driver,/attachTripContacts\(visible\)/);
 assert.match(driver,/document\.addEventListener\('visibilitychange'/);
 assert.match(driver,/window\.addEventListener\('pageshow'/);
 assert.match(driver,/tel:/);
 assert.match(driver,/Number unavailable/);
 assert.match(driver,/driver_id===profile\.id/);
});

test('Merchant starts in the Rider-style ride flow with the same draggable full-screen map sheet and vehicle cards',async()=>{
 const merchant=await read('../src/pages/MerchantDashboard.tsx');
 assert.match(merchant,/useState<ServiceType>\('ride'\)/);
 assert.match(merchant,/fixed inset-x-0 bottom-\[calc\(76px\+env\(safe-area-inset-bottom\)\)\]/);
 assert.match(merchant,/Drag or tap to expand or collapse ride booking panel/);
 assert.match(merchant,/bookingSheetDragging/);
 assert.match(merchant,/Who is travelling\?/);
 assert.match(merchant,/matmove-keke\.svg/);
 assert.match(merchant,/matmove-bike\.svg/);
 assert.match(merchant,/matmove-car\.svg/);
 assert.match(merchant,/matmove-van\.svg/);
 assert.doesNotMatch(merchant,/Dispatch Request/);
 assert.match(merchant,/Driver accepted · arriving/);
});

test('Rider and Merchant show driver name and tap-to-call phone after acceptance',async()=>{
 const [rider,merchant]=await Promise.all([read('../src/pages/RiderDashboard.tsx'),read('../src/pages/MerchantDashboard.tsx')]);
 for(const source of [rider,merchant]){
  assert.match(source,/Driver accepted · on the way/);
  assert.match(source,/href=\{\`tel:/);
  assert.match(source,/activeBooking\.driver\?\.full_name/);
 }
});

test('customer request recovery tells users to check the same id and does not encourage duplicate bookings',async()=>{
 const [rider,merchant,switcher]=await Promise.all([
  read('../src/pages/RiderDashboard.tsx'),read('../src/pages/MerchantDashboard.tsx'),read('../src/components/CustomerTripSwitcher.tsx')
 ]);
 assert.match(rider,/Reconnect to your original request/);
 assert.match(merchant,/Reconnect to your original request/);
 assert.match(rider,/tripRequest\.submit\(\)/);
 assert.match(merchant,/tripRequest\.submit\(\)/);
 assert.match(switcher,/Driver accepted · arriving/);
});

test('participant contact RPC is privacy-scoped and Merchant ride requests enter the driver radar lane',async()=>{
 const sql=await read('../supabase/migrations/20261114013851_matmove_shared_ride_dispatch_and_trip_contact_cards_v1.sql');
 assert.match(sql,/matmove_trip_contact_cards/);
 assert.match(sql,/v_role in \('rider','merchant'\) and b\.rider_id=v_uid/);
 assert.match(sql,/v_role='driver'/);
 assert.match(sql,/matmove_driver_radar_visible/);
 assert.match(sql,/new\.service_type='ride'/);
 assert.match(sql,/p\.role='merchant'/);
 assert.match(sql,/new\.status:='pending'/);
 assert.match(sql,/grant execute on function public\.matmove_trip_contact_cards\(uuid\[\]\) to authenticated/);
});

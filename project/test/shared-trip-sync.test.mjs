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
  assert.ok(source.includes('href={`tel:'));
  assert.match(source,/activeBooking\.driver\?\.full_name/);
 }
});

test('unresolved earlier requests are routed from Create into Trips for safe recovery',async()=>{
 const [rider,merchant,trips,app]=await Promise.all([
  read('../src/pages/RiderDashboard.tsx'),read('../src/pages/MerchantDashboard.tsx'),
  read('../src/components/TripHistory.tsx'),read('../src/App.tsx')
 ]);
 for(const source of [rider,merchant]){
  assert.match(source,/An earlier request needs checking/);
  assert.match(source,/onOpenTrips\?\.\(\)/);
  assert.doesNotMatch(source,/CustomerTripSwitcher/);
 }
 assert.match(trips,/onResume\(t\.id\)/);
 assert.match(app,/setResumeTripId\(bookingId\);setActiveSection\('ride'\)/);
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

test('Trips is the only customer location for unfinished requests and reopens the selected booking',async()=>{
 const [rider,merchant,trips,hook]=await Promise.all([
  read('../src/pages/RiderDashboard.tsx'),read('../src/pages/MerchantDashboard.tsx'),
  read('../src/components/TripHistory.tsx'),read('../src/lib/useRideNegotiation.ts')
 ]);
 for(const source of [rider,merchant]){
  assert.doesNotMatch(source,/CustomerTripSwitcher/);
  assert.match(source,/hasUnfinishedBookings/);
  assert.match(source,/useCustomerActiveRide\(profile(\?\.id|\.id), resumeTripId \|\| null\)/);
 }
 assert.match(trips,/onResume\(t\.id\)/);
 assert.match(trips,/Reopen original request/);
 assert.match(hook,/resumeBookingId: string \| null = null/);
 assert.match(hook,/selection\.current \? withCash\.find/);
 assert.doesNotMatch(hook,/withCash\.find\(row=>row\.id===selection\.current\)\|\|withCash\[0\]/);
});
test('Driver keeps assigned unfinished rides recoverable while offline but hides unassigned radar requests',async()=>{
 const driver=await read('../src/pages/DriverDashboard.tsx');
 assert.match(driver,/if \(activeSection !== 'home'\) \{ setRequestsLoading\(false\); setRequestsError\(''\); return; \}/);
 assert.match(driver,/item\.driver_id===profile\.id\|\|\(isOnline&&!item\.driver_id/);
 assert.doesNotMatch(driver,/if \(!isOnline \|\| activeSection !== 'home'\) \{ setActiveRequests\(\[\]\)/);
});

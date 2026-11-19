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
 assert.match(app,/rememberTrip\(bookingId\);setActiveSection\('ride'\)/);
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
 assert.match(trips,/Continue request/);
 assert.match(hook,/resumeBookingId: string \| null = null/);
 assert.match(hook,/const data = exact \|\| withCash\.find/);
 assert.match(hook,/readSavedActiveBooking\(userId\)/);
});
test('Driver keeps assigned unfinished rides recoverable while offline but hides unassigned radar requests',async()=>{
 const driver=await read('../src/pages/DriverDashboard.tsx');
 assert.match(driver,/if \(activeSection !== 'home'\) \{ setRequestsLoading\(false\); setRequestsError\(''\); return; \}/);
 assert.match(driver,/item\.driver_id===profile\.id\|\|\(isOnline&&!item\.driver_id/);
 assert.doesNotMatch(driver,/if \(!isOnline \|\| activeSection !== 'home'\) \{ setActiveRequests\(\[\]\)/);
});

test('Rider uses the Merchant one-sheet sequence: location selection first, vehicle/fare panel second',async()=>{
 const rider=await read('../src/pages/RiderDashboard.tsx');
 const merchant=await read('../src/pages/MerchantDashboard.tsx');
 assert.match(rider,/layout="map-first"/);
 assert.match(merchant,/layout="map-first"/);
 assert.match(rider,/activeBooking \|\| \(pickupCoords && destinationCoords && !routeEditing\)/);
 assert.doesNotMatch(rider,/activeBooking \|\| viewMode === 'new' \|\|/);
 assert.match(rider,/Choose your vehicle/);
 assert.match(rider,/Total Fare \(SLE\)/);
});
test('review-only cash bookings stay in Trips but are excluded from the Rider and Merchant live booking selection',async()=>{
 const hook=await read('../src/lib/useRideNegotiation.ts');
 const trips=await read('../src/components/TripHistory.tsx');
 assert.match(hook,/status === 'cash_review_required' \? null/);
 assert.match(hook,/row\.status!=='cash_review_required'/);
 assert.match(hook,/hasCashReviewCases:bookings\.some/);
 assert.doesNotMatch(trips,/\['pending','pending_admin','cash_reserve_pending','cash_review_required','accepted','in_progress'\]\.includes\(t\.status\)&&<button[^]*?onResume/);
 assert.match(trips,/Payment review/);
 assert.doesNotMatch(trips,/No cash settlement or refund has been recorded/);
 assert.match(trips,/t\.status==='in_progress'&&t\.cashReturn/);
 assert.match(trips,/cashReturnLabel/);
 assert.match(trips,/Physical cash return/);
 assert.doesNotMatch(trips,/Needs payment review/);
});
test('scheduled stale cash return quarantine closes dispatch without settling or refunding money',async()=>{
 const migration=await read('../supabase/migrations/20261117033000_matmove_stale_cash_handover_quarantine_v1.sql');
 assert.ok(migration.includes("cash_return_requested_at < pg_catalog.clock_timestamp() - interval '24 hours'"));
 assert.match(migration,/cp\.cash_return_driver_confirmed_at is null\s+or cp\.cash_return_rider_confirmed_at is null/);
 assert.match(migration,/set status='review_required'/);
 assert.match(migration,/set status='cash_review_required'/);
 assert.match(migration,/cashDispatchClosedForReview/);
 assert.match(migration,/cash_handover_confirmation_stale/);
 assert.match(migration,/moneyMovement/);
 assert.doesNotMatch(migration,/insert into public\.matmove_cash_ride_legs/i);
 assert.doesNotMatch(migration,/set cash_return_status\s*=|set manual_resolution_at\s*=/i);
});

test('cash review is not a retained active-request pointer and does not block a fresh customer booking',async()=>{
 const request=await read('../src/lib/useTripRequest.ts');
 const rider=await read('../src/pages/RiderDashboard.tsx');
 const merchant=await read('../src/pages/MerchantDashboard.tsx');
 const restore=request.slice(request.indexOf('async function restore'),request.indexOf('async function submit'));
 assert.match(restore,/row&&\['cash_review_required','completed','cancelled'\]\.includes\(row\.status\)\)row=null/);
 assert.match(restore,/\.in\('status',\['pending','pending_admin','cash_reserve_pending','accepted','in_progress'\]\)/);
 assert.match(rider,/const restored = await tripRequest\.restore\(\)/);
 assert.match(merchant,/const restored = await tripRequest\.restore\(\)/);
});

test('restored cash-review pointer is cleared synchronously before Rider and Merchant submit the next request',async()=>{
 const [request,rider,merchant]=await Promise.all([
  read('../src/lib/useTripRequest.ts'),
  read('../src/pages/RiderDashboard.tsx'),
  read('../src/pages/MerchantDashboard.tsx')
 ]);
 assert.ok(request.includes('retainedRef.current=null;setRetained(null)'));
 assert.ok(request.includes('const savedRequest = retainedRef.current;'));
 assert.ok(request.includes('const body = savedRequest ||'));
 for(const page of [rider,merchant]) assert.match(page,/recoveredSavedRequest = true/);
});


test('Rider and Merchant route editing use one synchronized sheet and wait for a valid route preview',async()=>{
 const [rider,merchant,picker]=await Promise.all([
  read('../src/pages/RiderDashboard.tsx'),
  read('../src/pages/MerchantDashboard.tsx'),
  read('../src/components/RideLocationPicker.tsx')
 ]);
 for(const source of [rider,merchant]){
  assert.match(source,/bookingReady=\{Boolean\(pickupCoords && destinationCoords && !routeEditing\)\}/);
  assert.doesNotMatch(source,/setRouteEditing\(!ready\)/);
 }
 assert.match(picker,/setEditingRoute\(true\);\s*onRouteEditingChange\?\.\(true\)/);
 assert.doesNotMatch(picker,/setLocationPanelExpanded/);
 assert.match(picker,/setEditingRoute\(false\);\s*onRouteEditingChange\?\.\(false\)/);
 assert.match(picker,/status === 'OK'[\s\S]*setEditingRoute\(false\)/);
});

test('Rider Ride tab displays the unfinished cash-review notice instead of hiding it on Home only',async()=>{
 const rider=await read('../src/pages/RiderDashboard.tsx');
 assert.match(rider,/\(activeSection === 'home' \|\| activeSection === 'ride'\) && hasUnfinishedBookings && !activeBooking/);
 assert.match(rider,/A previous cash request is under review/);
});

test('stale cash requests with an exact verified fee reserve are closed from live matching without refunding or capturing',async()=>{
 const migration=await read('../supabase/migrations/20261117033000_matmove_stale_cash_handover_quarantine_v1.sql');
 assert.match(migration,/b\.status in \('pending','pending_admin'\)/);
 assert.match(migration,/b\.driver_id is null[\s\S]*b\.started_at is null/);
 assert.match(migration,/cp\.status='fee_reserved'/);
 assert.match(migration,/cp\.cash_return_status='not_requested'/);
 assert.match(migration,/reserve\.status='completed'/);
 assert.match(migration,/reserve\.verified_amount_minor=cp\.matmove_fee_minor/);
 assert.match(migration,/reserve\.verified_currency=cp\.currency/);
 assert.match(migration,/set status='review_required'/);
 assert.match(migration,/set status='cash_review_required'/);
 assert.match(migration,/stale_cash_fee_reserve_request/);
 assert.match(migration,/staleCashReserveQuarantined/);
 assert.match(migration,/cashDispatchClosedForReview',true/);
 assert.match(migration,/moneyMovement',false/);
 assert.doesNotMatch(migration,/insert into public\.matmove_cash_ride_legs/i);
});

test('Trip History distinguishes a returned cash handover from an old reserved duplicate',async()=>{
 const trips=await read('../src/components/TripHistory.tsx');
 assert.match(trips,/cashReturnLabel/);
 assert.match(trips,/driver_confirmed: 'Driver confirmed'/);
 assert.match(trips,/rider_confirmed: 'Customer confirmed'/);
 assert.match(trips,/both_confirmed: 'Both parties confirmed'/);
 assert.doesNotMatch(trips,/Needs payment review/);
 assert.match(trips,/Payment review/);
 assert.match(trips,/Driver confirmed/);
 assert.match(trips,/Customer confirmed/);
 assert.match(trips,/Both parties confirmed/);
 assert.doesNotMatch(trips,/verified MatMove fee reserve is awaiting support reconciliation/);
 assert.doesNotMatch(trips,/driver recorded returning the physical cash/);
});


test('bookings RLS grants authenticated participants a permissive own-booking read without weakening restrictive policy',async()=>{
 const migration=await read('../supabase/migrations/20261117095000_matmove_bookings_owner_select_v1.sql');
 assert.match(migration,/create policy matmove_bookings_owner_select/);
 assert.match(migration,/as permissive/);
 assert.match(migration,/for select/);
 assert.match(migration,/to authenticated/);
 assert.match(migration,/rider_id = \(select auth\.uid\(\)\)/);
 assert.match(migration,/driver_id = \(select auth\.uid\(\)\)/);
 assert.doesNotMatch(migration,/drop policy .*matmove_dispatch_visibility|drop policy .*matmove_lock_bookings_select/i);
});

test('customer active ride restores the exact saved booking or newest unfinished server booking after reload',async()=>{
 const hook=await read('../src/lib/useRideNegotiation.ts');
 assert.match(hook,/matmove:active-booking:v1:/);
 assert.match(hook,/readSavedActiveBooking\(userId\)/);
 assert.match(hook,/saveActiveBooking\(userId, selection\.current \|\| null\)/);
 assert.match(hook,/const data = exact \|\| withCash\.find/);
 assert.match(hook,/\['pending','pending_admin','cash_reserve_pending','accepted','in_progress'\]/);
 assert.match(hook,/saveActiveBooking\(userId,id\)/);
});

test('Trips opens customer accounts on Pending and retains Driver Live/Active as its first view',async()=>{
 const trips=await read('../src/components/TripHistory.tsx');
 assert.match(trips,/useState<'active'\|'pending'\|'history'>\(role==='driver'\?'active':'pending'\)/);
 assert.match(trips,/label:'Requests'/);
 assert.match(trips,/\{id:'history',label:'History'/);
});

test('portal restores last tab and selected request after a full reload and all role dashboards pass the booking ID',async()=>{
 const app=await read('../src/App.tsx');
 const rider=await read('../src/pages/RiderDashboard.tsx');
 const merchant=await read('../src/pages/MerchantDashboard.tsx');
 assert.match(app,/sessionStorage\.getItem\(\`matmove:portal-section:v1:/);
 assert.match(app,/localStorage\.getItem\(\`matmove:active-booking:v1:/);
 assert.match(app,/rememberTrip\(bookingId\)/);
 assert.match(app,/onOpenTrips=\{\(bookingId\?:string\|null\)=>\{if\(bookingId\)rememberTrip\(bookingId\)/);
 assert.match(rider,/onOpenTrips\?\.\(booking\.id\)/);
 assert.match(merchant,/onOpenTrips\?\.\(data\.id\)/);
 assert.doesNotMatch(app,/if\(section==='ride'\)setResumeTripId\(null\)/);
});

test('Driver radar only displays its initial loading state and keeps cards stable during polling',async()=>{
 const driver=await read('../src/pages/DriverDashboard.tsx');
 const fetcher=driver.slice(driver.indexOf('const fetchInitialRequests'),driver.indexOf('const refreshOnResume'));
 assert.match(driver,/requestsLoadedOwner = useRef\(''\)/);
 assert.match(driver,/if \(requestsLoadedOwner\.current !== profile\.id\) setRequestsLoading\(true\)/);
 assert.doesNotMatch(fetcher,/busy = true; const readVersion = radarMutation\.current; setRequestsLoading\(true\)/);
 assert.match(fetcher,/loadedSuccessfully = true/);
 assert.match(fetcher,/requestsLoadedOwner\.current = profile\.id/);
 assert.match(driver,/}, 10000\)/);
});

test('MatMove passcode remains available without a visible in-app biometric or passkey control',async()=>{
 const passcode=await read('../src/components/CustomerPasscode.tsx');
 assert.match(passcode,/Enter your passcode to continue/);
 assert.match(passcode,/6–9 digit passcode/);
 assert.doesNotMatch(passcode,/platformPasskeyAvailable|registerPasskey|signInWithPasskey|passkey\.list|Face ID|Touch ID|Set up.*biometric|Unlock with.*biometric/i);
});

test('Rider, Merchant and Driver label digital ride settlement as escrow-backed',async()=>{
 const [rider,merchant,driver]=await Promise.all([
  read('../src/pages/RiderDashboard.tsx'),
  read('../src/pages/MerchantDashboard.tsx'),
  read('../src/pages/DriverDashboard.tsx')
 ]);
 assert.match(rider,/Digital wallet — full fare escrow/);
 assert.match(merchant,/Digital · full fare escrow/);
 assert.match(driver,/Digital · escrow-backed driver share/);
});

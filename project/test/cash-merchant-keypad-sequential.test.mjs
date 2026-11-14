import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('cash confirmation status is read-only and refreshes the same cash ledger for customer and assigned driver',async()=>{
 const [service,api,server,hook,driver]=await Promise.all([
  read('../src/services/rideService.ts'),
  read('../server/ride-api.js'),
  read('../server/cash-ride-payments.js'),
  read('../src/lib/useRideNegotiation.ts'),
  read('../src/pages/DriverDashboard.tsx')
 ]);
 assert.match(service,/readCashRideStatus/);
 assert.match(service,/accept-ride-escrow\?action=cash_status/);
 assert.match(service,/finish\(\)/);
 assert.match(api,/cash_status/);
 assert.match(api,/'cash_status',\s*'reconcile'/);
 assert.match(server,/action === 'status' \|\| action === 'cash_status'/);
 assert.match(server,/if \(!isRider && !isDriver\)/);
 assert.match(hook,/readCashRideStatus\(row\.id\)/);
 assert.match(hook,/cashPayment:cashById\.get\(row\.id\)/);
 assert.match(driver,/readCashRideStatus\(item\.id\)/);
 assert.match(driver,/cashPayment:cashById\.get\(item\.id\)/);
});

test('driver confirmation persists receipt state and removes the action once the driver has confirmed',async()=>{
 const driver=await read('../src/pages/DriverDashboard.tsx');
 const handler=driver.slice(driver.indexOf('const handleConfirmCashReceived'),driver.indexOf('const handleCancelRide'));
 assert.match(handler,/void fetchLiveBalance\(\)/);
 assert.doesNotMatch(handler,/await fetchLiveBalance\(\)/);
 assert.match(driver,/cashPayment: result\.payment \|\| item\.cashPayment/);
 assert.match(driver,/r\.cashPayment\?\.driverCashConfirmed/);
 assert.match(driver,/Waiting for the customer to confirm the handover/);
 assert.match(driver,/Both parties confirmed/);
 assert.match(driver,/Confirm Cash Received/);
});

test('Rider cash confirmation shows the assigned-driver and fee-capture states',async()=>{
 const rider=await read('../src/pages/RiderDashboard.tsx');
 assert.match(rider,/cashPayment: payment \|\| activeBooking\.cashPayment/);
 assert.match(rider,/activeBooking\.cashPayment\?\.driverCashConfirmed/);
 assert.match(rider,/activeBooking\.cashPayment\?\.riderCashConfirmed/);
 assert.match(rider,/Waiting for the assigned driver to confirm receipt/);
 assert.match(rider,/MatMove's fee capture is being verified/);
});

test('Merchant can book cash rides, reserve only the fee, and confirm the same two-party handover',async()=>{
 const [merchant,requestHook,api,server,migration]=await Promise.all([
  read('../src/pages/MerchantDashboard.tsx'),
  read('../src/lib/useTripRequest.ts'),
  read('../server/ride-api.js'),
  read('../server/cash-ride-payments.js'),
  read('../supabase/migrations/20261114090000_matmove_cash_ride_merchant_role_and_audit_support_v1.sql')
 ]);
 assert.match(merchant,/payment_method:serviceType==='ride'\?paymentMethod:'digital'/);
 assert.match(merchant,/serviceType === 'ride' && paymentMethod === 'cash'/);
 assert.match(merchant,/handleCashRideConfirmation/);
 assert.match(merchant,/cashPayment\?\.driverCashConfirmed/);
 assert.match(merchant,/cashPayment\?\.riderCashConfirmed/);
 assert.match(requestHook,/reserveCashRide\(body\.id/);
 assert.match(api,/cash_status/);
 assert.match(server,/!\['rider','merchant'\]\.includes\(profile\.role\)/);
 assert.match(server,/\['rider','merchant'\]\.includes\(actorType\)/);
 assert.match(migration,/role_name not in \('rider','merchant'\)/);
 assert.match(migration,/rider\.role in \('rider','merchant'\)/);
 assert.match(migration,/p_actor_type not in \('rider','merchant','driver'\)/);
 assert.match(migration,/actor_type = any \(array\['system','rider','merchant','driver','admin'\]/);
});

test('cash capture still requires both customer and driver confirmation and distinct fee accounts',async()=>{
 const [cashServer,migration]=await Promise.all([
  read('../server/cash-ride-payments.js'),
  read('../supabase/migrations/20261113143000_matmove_cash_shared_account_ledger_settlement.sql')
 ]);
 assert.match(cashServer,/confirmation\.captureReady/);
 assert.match(cashServer,/finishCashLeg\(db, bookingId, 'capture'/);
 assert.match(migration,/p\.driver_cash_confirmed_at is not null/);
 assert.match(migration,/p\.rider_cash_confirmed_at is not null/);
 assert.match(migration,/reserve_leg\.status <> 'completed'/);
 assert.match(migration,/capture_leg\.source_account_ref <> cfg\.fee_hold_account_id/);
 assert.match(cashServer,/data\.fee_hold_account_id !== escrowAccountId/);
 assert.match(cashServer,/data\.fee_revenue_account_id !== platformFeeAccountId/);
 assert.match(cashServer,/data\.fee_hold_account_id === platformFeeAccountId/);
});

test('Merchant location selection and Ride booking form are sequential with one bottom sheet at a time',async()=>{
 const [merchant,rider,picker]=await Promise.all([
  read('../src/pages/MerchantDashboard.tsx'),
  read('../src/pages/RiderDashboard.tsx'),
  read('../src/components/RideLocationPicker.tsx')
 ]);
 assert.match(merchant,/const \[routeEditing,setRouteEditing\]=useState\(true\)/);
 assert.match(merchant,/activeBooking \|\| \(pickupCoords && destinationCoords && !routeEditing\)/);
 assert.match(merchant,/bookingReady=\{Boolean\(pickupCoords && destinationCoords\)\}/);
 assert.match(merchant,/onRouteEditingChange=\{setRouteEditing\}/);
 assert.match(merchant,/setRouteEditing\(!ready\)/);
 assert.match(rider,/routeEditing/);
 assert.match(picker,/bookingReady&&!editingRoute/);
 assert.match(picker,/sticky top-0 z-20/);
 assert.match(merchant,/sticky top-0 z-20/);
 assert.match(rider,/sticky top-0 z-20/);
});

test('Services back arrow is left of the Wi dey move brand',async()=>{
 const portal=await read('../src/components/PortalHome.tsx');
 assert.match(portal,/mode==='services'&&<button className="mm-icon-button shrink-0" type="button" aria-label="Back to Home"/);
 assert.match(portal,/mm-brand/);
 assert.match(portal,/Open your account/);
});

test('passcode uses a custom visible 0–9 keypad without a native numeric or password input',async()=>{
 const passcode=await read('../src/components/CustomerPasscode.tsx');
 assert.match(passcode,/Passcode keypad/);
 assert.match(passcode,/\['1','2','3','4','5','6','7','8','9'\]/);
 assert.match(passcode,/appendDigit\('0'\)/);
 assert.match(passcode,/Delete last digit/);
 assert.match(passcode,/pinField\('New passcode/);
 assert.match(passcode,/Confirm new passcode/);
 assert.doesNotMatch(passcode,/inputMode="numeric"/);
 assert.doesNotMatch(passcode,/type="password"/);
});

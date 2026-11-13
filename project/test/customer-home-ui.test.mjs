import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=path=>readFile(new URL(path,import.meta.url),'utf8');
test('customer landing and auth screens show an animated, labelled Freetown route',async()=>{
 const [landing,auth]=await Promise.all([read('../src/pages/LandingPage.tsx'),read('../src/components/AuthShell.tsx')]);
 assert.match(landing,/animateMotion/);assert.match(landing,/Illustrative route preview/);
 assert.match(auth,/animateMotion/);assert.match(auth,/FREETOWN ROUTE PREVIEW/);
});
test('customer home starts with ride intent, role-aware services and no more than three home updates',async()=>{
 const [home,posts]=await Promise.all([read('../src/components/CustomerHome.tsx'),read('../src/components/CustomerHomePosts.tsx')]);
 assert.match(home,/Where to\?/);assert.match(home,/Driver radar/);assert.match(home,/My shop/);
 assert.match(home,/CustomerHomePosts/);assert.match(posts,/\.limit\(3\)/);assert.match(posts,/matmove_submit_homepage_post_enquiry/);
});
test('passcode unlock remounts the workspace and returns the user to Home',async()=>{
 const [app,pass]=await Promise.all([read('../src/App.tsx'),read('../src/components/CustomerPasscode.tsx')]);
 assert.match(app,/useState<PortalSection>\('home'\)/);assert.match(pass,/workspaceVersion/);
});

test('homepage feed replaces the decorative route demo with admin-published moving post cards',async()=>{
 const [home,feed,ride,map]=await Promise.all([
  read('../src/components/CustomerHome.tsx'),
  read('../src/components/CustomerHomePosts.tsx'),
  read('../src/pages/RiderDashboard.tsx'),
  read('../src/components/RideLocationPicker.tsx')
 ]);
 assert.doesNotMatch(home,/CustomerHomeMap/);
 assert.match(home,/CustomerHomePosts userId=\{profile\.id\}/);
 assert.match(feed,/Happening in Sierra Leone/);
 assert.match(feed,/animateMotion/);
 assert.match(feed,/postgres_changes/);
 assert.match(feed,/starts_at\.lte/);
 assert.match(feed,/expires_at\.gt/);
 assert.match(feed,/matmove_submit_homepage_post_enquiry/);
 assert.match(ride,/bookingSheetExpanded/);
 assert.match(ride,/onPointerDown/);
 assert.match(ride,/onPointerUp/);
 assert.match(map,/keyboardShortcuts: false/);
});


test('ride booking uses a full-screen map and draggable Uber-style location sheet',async()=>{
 const [picker,ride,app]=await Promise.all([
  read('../src/components/RideLocationPicker.tsx'),
  read('../src/pages/RiderDashboard.tsx'),
  read('../src/App.tsx')
 ]);
 assert.match(picker,/fixed inset-0 z-10/);
 assert.match(picker,/Plan your ride/);
 assert.match(picker,/onPointerMove/);
 assert.match(picker,/onPointerUp/);
 assert.match(picker,/Back to MatMove home/);
 assert.match(picker,/Change locations/);
 assert.match(ride,/bookingReady=\{Boolean\(pickupCoords && destinationCoords\)\}/);
 assert.match(ride,/onRouteEditingChange=\{setRouteEditing\}/);
 assert.match(ride,/fixed inset-x-0 bottom/);
 assert.match(ride,/max-h-\[148px\]/);
 assert.match(app,/onBack=\{\(\) => setActiveSection\('home'\)\}/);
});

test('ride vehicle selector and map pins use branded visual markers instead of plain text or default pins',async()=>{
 const [ride,picker]=await Promise.all([
  read('../src/pages/RiderDashboard.tsx'),
  read('../src/components/RideLocationPicker.tsx')
 ]);
 assert.match(ride,/CarFront, Bike, Truck/);
 assert.match(ride,/Choose \$\{label\}/);
 assert.match(ride,/bg-gradient-to-br from-emerald-50 via-white to-sky-50/);
 assert.match(ride,/Who is travelling\?/);
 assert.match(picker,/markerSvg/);
 assert.match(picker,/data:image\/svg\+xml/);
 assert.match(picker,/draggable: true/);
});

test('homepage post storage upload allowlist grants only the named admin permission',async()=>{
 const sql=await read('../supabase/migrations/20261113160500_matmove_homepage_post_storage_upload_allowlist_v1.sql');
 assert.match(sql,/as restrictive/i);
 assert.match(sql,/bucket_id = 'matmove-homepage-posts'/);
 assert.match(sql,/public\.matmove_admin_can\('notifications'\)/);
 assert.match(sql,/bucket_id = 'kyc-documents'/);
 assert.match(sql,/bucket_id = 'product_images'/);
 assert.doesNotMatch(sql,/to public/i);
});


test('customer homepage posts render complete artwork and optional USD or SLE prices',async()=>{
 const page=await read('../src/components/CustomerHomePosts.tsx');
 assert.match(page,/price_amount,price_currency/);
 assert.match(page,/postPrice\(post\.price_amount,post\.price_currency\)/);
 assert.match(page,/max-h-\[min\(72vh,620px\)\]/);
 assert.match(page,/matmove-keke\.svg/);
 assert.match(page,/matmove-bike\.svg/);
 assert.match(page,/matmove-car\.svg/);
 assert.match(page,/matmove-van\.svg/);
});
test('MatMove vehicle artwork covers Keke, bike, car and van with branded green and blue details',async()=>{
 const [keke,bike,car,van]=await Promise.all([
  read('../public/matmove-keke.svg'),read('../public/matmove-bike.svg'),read('../public/matmove-car.svg'),read('../public/matmove-van.svg')
 ]);
 for(const svg of [keke,bike,car,van]){assert.match(svg,/<svg/);assert.match(svg,/linearGradient/);assert.match(svg,/#2/);}
 assert.match(keke,/viewBox="0 0 512 320"/);
 assert.match(bike,/viewBox="0 0 512 320"/);
});
test('saved Home and Work addresses render as bordered updateable cards',async()=>{
 const picker=await read('../src/components/RideLocationPicker.tsx');
 assert.ok(picker.includes('Save this {target}'));
 assert.match(picker,/border border-slate-200 bg-white px-2\.5 py-2/);
 assert.match(picker,/Update/);
});


test('ride location panel follows the finger continuously and the map remains full-screen behind it',async()=>{
 const picker=await read('../src/components/RideLocationPicker.tsx');
 assert.match(picker,/height:'100dvh',minHeight:'100dvh'/);
 assert.match(picker,/const \[locationSheetDragging,setLocationSheetDragging\]=useState\(false\)/);
 assert.match(picker,/calc\(\$\{locationDragStartHeight\.current\}px - \$\{locationDragDelta\}px\)/);
 assert.match(picker,/height 380ms cubic-bezier\(\.22,1,\.36,1\)/);
 assert.match(picker,/setLocationDragDelta\(Math\.max\(base-maxHeight,Math\.min\(base-180,delta\)\)\)/);
 assert.doesNotMatch(picker,/transform:locationDragDelta/);
});
test('ride booking sheet height tracks the drag handle and snaps smoothly on release',async()=>{
 const page=await read('../src/pages/RiderDashboard.tsx');
 assert.match(page,/const \[bookingSheetDragging,setBookingSheetDragging\]=useState\(false\)/);
 assert.match(page,/calc\(\$\{sheetDragStartHeight\.current\}px - \$\{bookingSheetDragDelta\}px\)/);
 assert.match(page,/height 380ms cubic-bezier\(\.22,1,\.36,1\)/);
 assert.match(page,/setBookingSheetExpanded\(nextHeight>=maxHeight\*\.55\)/);
 assert.doesNotMatch(page,/transform:bookingSheetDragDelta/);
});
test('driver home offers driver work only; vehicle rental remains a customer booking service',async()=>{
 const home=await read('../src/components/CustomerHome.tsx');
 const driver=home.slice(home.indexOf('const driverServices=['),home.indexOf('const merchantServices=['));
 const customer=home.slice(home.indexOf('const customerServices=['),home.indexOf('const driverServices=['));
 assert.doesNotMatch(driver,/Vehicle rental|rental/i);
 assert.match(customer,/label:'Rental'/);
 assert.match(home,/driver\?driverServices/);
});
test('login and customer role onboarding use branded MatMove vehicle illustrations',async()=>{
 const shell=await read('../src/components/AuthShell.tsx');
 const onboarding=await read('../src/pages/OnboardingPages.tsx');
 assert.match(shell,/src="\/matmove-car\.svg"/);
 assert.match(shell,/src="\/matmove-bike\.svg"/);
 assert.match(onboarding,/illustration: '\/matmove-car\.svg'/);
 assert.match(onboarding,/illustration: '\/matmove-bike\.svg'/);
});

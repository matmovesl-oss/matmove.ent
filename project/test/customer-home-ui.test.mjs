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
test('passcode is a full-screen overlay and preserves the mounted customer workspace',async()=>{
 const [app,pass]=await Promise.all([read('../src/App.tsx'),read('../src/components/CustomerPasscode.tsx')]);
 assert.match(app,/useState<PortalSection>\(\(\) =>/);
 assert.match(app,/sessionStorage\.getItem\(\`matmove:portal-section:v1:/);
 assert.match(app,/localStorage\.getItem\(\`matmove:active-booking:v1:/);
 assert.match(pass,/showModal\(\)/);
 assert.match(pass,/hidden=\{!allowed\}/);
 assert.match(pass,/enteredUser===userId&&children\(lock\)/);
 assert.doesNotMatch(pass,/workspaceVersion|key=\{workspaceVersion\}/);
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


test('ride booking uses an inline responsive map and lets the customer page scroll naturally',async()=>{
 const [picker,ride,app]=await Promise.all([
  read('../src/components/RideLocationPicker.tsx'),
  read('../src/pages/RiderDashboard.tsx'),
  read('../src/App.tsx')
 ]);
 assert.match(picker,/relative z-10 w-full min-w-0 bg-\[#e9eef1\]/,'map section should be inline and full width');
 assert.match(picker,/h-\[min\(56dvh,520px\)\]/,'map viewport should be bounded to a responsive height');
 assert.match(picker,/gestureHandling: 'greedy'/,'map should accept one-finger pan gestures');
 assert.doesNotMatch(picker,/mapFirst\?"fixed inset-0/,'map must not be fixed over the full viewport');
 assert.doesNotMatch(picker,/fixed inset-x-0 bottom-\[calc\(64px/,'location form must not be a fixed overlay');
 assert.match(picker,/Back to MatMove home/,'map back control must remain visible');
 assert.match(picker,/Change locations/,'location edit action must remain available');
 assert.match(ride,/bookingReady=\{Boolean\(pickupCoords && destinationCoords && !routeEditing\)\}/,'ride readiness must collapse location editing after route selection');
 assert.match(ride,/onRouteEditingChange=\{setRouteEditing\}/,'route edit state must remain controlled by the rider page');
 assert.match(app,/onBack=\{\s*\(\) =>\s*setActiveSection\('home'\)\s*\}/,'map back action must return to the MatMove home section');
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
 const sql=await read('../supabase/migrations/20261113161043_matmove_homepage_post_storage_upload_allowlist_v1.sql');
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


test('ride location form flows below the map and has no fixed draggable sheet',async()=>{
 const picker=await read('../src/components/RideLocationPicker.tsx');
 assert.match(picker,/relative z-30 mx-auto w-full max-w-5xl min-w-0/);
 assert.match(picker,/height:'auto',maxHeight:'none',overflow:'visible'/);
 assert.doesNotMatch(picker,/locationSheetDragging|locationDragStartHeight|locationDragDelta/);
 assert.doesNotMatch(picker,/Drag or tap to expand or collapse ride locations/);
 assert.doesNotMatch(picker,/fixed bottom-\[calc\(82px/);
});
test('ride booking sheet height tracks the drag handle and snaps smoothly on release',async()=>{
 const page=await read('../src/pages/RiderDashboard.tsx');
 assert.match(page,/const \[bookingSheetDragging,\s*setBookingSheetDragging\]\s*=\s*useState\(false\)/);
 assert.match(page,/calc\(\$\{sheetDragStartHeight\.current\}px - \$\{bookingSheetDragDelta\}px\)/);
 assert.match(page,/height 380ms cubic-bezier\(\.22,1,\.36,1\)/);
 assert.match(page,/setBookingSheetExpanded\(delta < -6 \? true : delta > 80 \? false : bookingSheetExpanded\)/);
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


test('large customer workspaces are lazy-loaded behind a glass loading state',async()=>{
 const app=await read('../src/App.tsx');
 assert.match(app,/lazy\(\(\)\s*=>\s*import\('@\/pages\/RiderDashboard'\)/);
 assert.match(app,/lazy\(\(\)\s*=>\s*import\('@\/pages\/DriverDashboard'\)/);
 assert.match(app,/lazy\(\(\)\s*=>\s*import\('@\/pages\/MerchantDashboard'\)/);
 assert.match(app,/lazy\(\(\)\s*=>\s*import\('@\/components\/ArcadeGames'\)/);
 assert.match(app,/lazy\(\(\)\s*=>\s*import\('@\/components\/ActivityAnalytics'\)/);
 assert.match(app,/lazy\(\(\)\s*=>\s*import\('@\/components\/MerchantAnalytics'\)/);
 assert.match(app,/<Suspense fallback=\{<CustomerWorkspaceLoading \/>\}>/);
 assert.match(app,/function CustomerWorkspaceLoading/);
 assert.doesNotMatch(app,/import\s*\{\s*RiderDashboard\s*\}\s*from\s*'@\/pages\/RiderDashboard'/);
 assert.doesNotMatch(app,/import\s*\{\s*DriverDashboard\s*\}\s*from\s*'@\/pages\/DriverDashboard'/);
 assert.doesNotMatch(app,/import\s*\{\s*MerchantDashboard\s*\}\s*from\s*'@\/pages\/MerchantDashboard'/);
});


test('services directory and games are excluded from the initial customer JavaScript bundle',async()=>{
 const app=await read('../src/App.tsx','utf8');
 const portal=await read('../src/components/PortalHome.tsx','utf8');
 assert.match(app,/const PortalHome = lazy\(\(\)\s*=>\s*import\('@\/components\/PortalHome'\)\)/);
 assert.doesNotMatch(app,/import PortalHome from '@\/components\/PortalHome'/);
 assert.match(app,/<Suspense fallback=\{<CustomerWorkspaceLoading \/>\}>/);
 assert.match(portal,/lazy\(\(\)\s*=>\s*import\('@\/components\/ArcadeGames'\)/);
 assert.match(portal,/<Suspense fallback=\{/);
 assert.doesNotMatch(portal,/import\s*\{\s*ArcadeGames\s*\}\s*from\s*'@\/components\/ArcadeGames'/);
});

test('customer portal keeps Guide and support in a compact tools popover and uses an icon-only back control',async()=>{
 const [app,support,guide,rider,driver,merchant]=await Promise.all([
  readFile(new URL('../src/App.tsx',import.meta.url),'utf8'),
  readFile(new URL('../src/components/CustomerSupport.tsx',import.meta.url),'utf8'),
  readFile(new URL('../src/components/PortalGuide.tsx',import.meta.url),'utf8'),
  readFile(new URL('../src/pages/RiderDashboard.tsx',import.meta.url),'utf8'),
  readFile(new URL('../src/pages/DriverDashboard.tsx',import.meta.url),'utf8'),
  readFile(new URL('../src/pages/MerchantDashboard.tsx',import.meta.url),'utf8')
 ]);
 assert.match(app,/aria-label="Open help, guide and support"/);
 assert.match(app,/aria-expanded=\{helpMenuOpen\}/);
 assert.match(app,/w-\[min\(20rem,calc\(100vw-5\.5rem\)\)\]/);
 assert.doesNotMatch(app,/onClickCapture=\{\(\)=>setHelpMenuOpen\(false\)\}/);
 assert.match(support,/max-h-\[min\(78dvh,620px\)\] w-full max-w-lg/);
 assert.match(guide,/max-h-\[72dvh\] w-\[calc\(100%_-_2rem\)\] max-w-sm/);
 assert.match(app,/aria-label=\{activeSection === 'ride' \? 'Back to Home' : 'Back to Services'\}/);
 assert.match(support,/event\.target===event\.currentTarget/);
 assert.match(guide,/const launched=replay>lastReplay\.current/);
 assert.match(rider,/grid w-\[min\(58vw,12rem\)\]/);
 assert.match(rider,/Cash review · saved safely/);
 assert.match(driver,/min-h-\[4\.5rem\]/);
 assert.match(merchant,/aria-label="Load wallet"/);
 assert.match(merchant,/Cash review · saved safely/);
 assert.match(merchant,/<details aria-label="A previous cash request is under review" className="m-3 rounded-xl/);
 assert.match(merchant,/Its live dispatch has been closed/);
 assert.match(merchant,/No cash settlement or refund has been recorded/);
 assert.match(merchant,/make a fresh request while the case remains visible in Trips/);
 assert.match(merchant,/min-h-\[4\.5rem\]/);
});

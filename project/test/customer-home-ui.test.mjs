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

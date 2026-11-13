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

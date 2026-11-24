import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('Support Media is a dedicated full-page account destination with back navigation',async()=>{
 const app=await readFile(new URL('../src/App.tsx',import.meta.url),'utf8');
 const page=await readFile(new URL('../src/components/SupportMediaPage.tsx',import.meta.url),'utf8');
 assert.match(app,/setActivePanel\('support-media'\)/);
 assert.match(app,/SupportMediaPage onBack=\{\(\) => setActivePanel\(null\)\}/);
 assert.match(app,/<b>Support Media<\/b>/);
 assert.match(page,/min-h-\[100dvh\]/);
 assert.match(page,/onBack/);
 assert.match(page,/Support Media/);
});

test('Support Media reads active published contacts and orders them from MatMove settings',async()=>{
 const page=await readFile(new URL('../src/components/SupportMediaPage.tsx',import.meta.url),'utf8');
 assert.match(page,/from\('matmove_public_contacts'\)/);
 assert.match(page,/\.eq\('is_active',true\)/);
 assert.match(page,/\.order\('display_order'/);
 assert.match(page,/\.order\('created_at'/);
});

test('Support Media routes WhatsApp to wa.me and social channels to verified HTTPS links',async()=>{
 const page=await readFile(new URL('../src/components/SupportMediaPage.tsx',import.meta.url),'utf8');
 assert.match(page,/https:\/\/wa\.me\//);
 assert.match(page,/url\.protocol==='https:'/);
 assert.match(page,/target="_blank" rel="noopener noreferrer"/);
 assert.match(page,/encodeURIComponent\('Hello MatMove Support'\)/);
 assert.match(page,/function PlatformIcon/);
 assert.match(page,/Instagram/);
 assert.match(page,/Facebook/);
 assert.match(page,/Youtube/);
 assert.match(page,/Linkedin/);
 assert.match(page,/Music2/);
 assert.match(page,/Ghost/);
});

test('the direct WhatsApp support number remains separate from the Support Media page',async()=>{
 const app=await readFile(new URL('../src/App.tsx',import.meta.url),'utf8');
 assert.match(app,/Chat with Support \(\+232 90 330 362\)/);
 assert.match(app,/Support Media/);
 assert.match(app,/Customer Support/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('customer Support & Socials reads only active public profiles and preserves the in-app support inbox',async()=>{
 const source=await readFile(new URL('../src/components/CustomerSupport.tsx',import.meta.url),'utf8');
 assert.match(source,/from\('matmove_public_contacts'\)/);
 assert.match(source,/\.eq\('is_active',true\)/);
 assert.match(source,/matmove_support_customer_list/);
 assert.match(source,/matmove_support_customer_open/);
 assert.match(source,/matmove_support_customer_message/);
 assert.match(source,/Message MatMove Support/);
 assert.match(source,/Support & Socials/);
});

test('customer contact links are HTTPS-only and WhatsApp is routed with an international number',async()=>{
 const source=await readFile(new URL('../src/components/CustomerSupport.tsx',import.meta.url),'utf8');
 assert.match(source,/url\.protocol==='https:'/);
 assert.match(source,/https:\/\/wa\.me\//);
 assert.match(source,/noopener noreferrer/);
 assert.match(source,/target="_blank"/);
 assert.match(source,/encodeURIComponent\('Hello MatMove Support'\)/);
});

test('customer support receives database changes and keeps a refresh fallback',async()=>{
 const source=await readFile(new URL('../src/components/CustomerSupport.tsx',import.meta.url),'utf8');
 assert.match(source,/postgres_changes/);
 assert.match(source,/table:'matmove_public_contacts'/);
 assert.match(source,/window\.setInterval[\s\S]{0,100}60000/);
 assert.match(source,/document\.addEventListener\('visibilitychange'/);
 assert.match(source,/supabase\.removeChannel\(channel\)/);
});

test('customer contact migration enables active-only public reads and keeps writes in an authorized RPC',async()=>{
 const migration=await readFile(new URL('../supabase/migrations/20261122030000_matmove_public_contacts_socials_whatsapp_v1.sql',import.meta.url),'utf8');
 assert.match(migration,/enable row level security/i);
 assert.match(migration,/using \(is_active is true\)/i);
 assert.match(migration,/grant select \(id,kind,platform_name,link_url,whatsapp_phone,icon_key,is_active,display_order,version,created_at,updated_at\)/i);
 assert.match(migration,/matmove_admin_can\('support'\)/);
 assert.match(migration,/p_actor is distinct from auth\.uid\(\)/);
 assert.match(migration,/grant execute on function public\.matmove_admin_public_contacts[\s\S]*to authenticated/i);
 assert.match(migration,/alter publication supabase_realtime add table public\.matmove_public_contacts/i);
});

test('database rejects unsafe social links, malformed WhatsApp numbers, and WhatsApp hard deletion',async()=>{
 const migration=await readFile(new URL('../supabase/migrations/20261122030000_matmove_public_contacts_socials_whatsapp_v1.sql',import.meta.url),'utf8');
 assert.match(migration,/link_url !~\* '\^https:\/\//);
 assert.match(migration,/v_phone !~ '\^\[1-9\]\[0-9\]\{7,14\}\$'/);
 assert.match(migration,/WhatsApp support cannot be deleted/);
 assert.match(migration,/version=version\+1/);
});

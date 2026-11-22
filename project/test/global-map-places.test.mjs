import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('Google Places autocomplete searches globally and uses the visible map viewport only as a bias',async()=>{
 const source=await readFile(new URL('../src/components/RideLocationPicker.tsx',import.meta.url),'utf8');
 assert.doesNotMatch(source,/includedRegionCodes/);
 assert.doesNotMatch(source,/componentRestrictions:\s*\{\s*country:\s*['"]SL/);
 assert.doesNotMatch(source,/region:\s*['"]SL['"]/);
 assert.match(source,/const viewport=map\.current\?\.getBounds\(\)/);
 assert.match(source,/request\.locationBias=viewport/);
 assert.match(source,/geocoder\.current\.geocode\(request/);
 assert.match(source,/minZoom:\s*2/);
 assert.match(source,/Worldwide place search/);
});

test('customer picker reads only active MatMove-curated places and refreshes them through Realtime',async()=>{
 const source=await readFile(new URL('../src/components/RideLocationPicker.tsx',import.meta.url),'utf8');
 assert.match(source,/from\('matmove_map_places'\)/);
 assert.match(source,/\.eq\('is_active',true\)/);
 assert.match(source,/postgres_changes/);
 assert.match(source,/table:'matmove_map_places'/);
 assert.match(source,/MatMove verified places/);
 assert.match(source,/chooseMatMovePlace/);
 assert.match(source,/map\.current\?\.panTo\(position\)/);
});

test('MatMove places migration publishes active-only locations while requiring dispatch permission for changes',async()=>{
 const migration=await readFile(new URL('../supabase/migrations/20261122025013_matmove_global_public_places_admin_directory_v1.sql',import.meta.url),'utf8');
 assert.match(migration,/enable row level security/i);
 assert.match(migration,/using\(is_active is true\)/i);
 assert.match(migration,/grant select \(id,name,category,address,city,region,country_code,latitude,longitude/);
 assert.match(migration,/public\.matmove_admin_can\('dispatch'\)/);
 assert.match(migration,/p_actor is distinct from auth\.uid\(\)/);
 assert.match(migration,/latitude between -90 and 90/);
 assert.match(migration,/longitude between -180 and 180/);
 assert.match(migration,/alter publication supabase_realtime add table public\.matmove_map_places/i);
});

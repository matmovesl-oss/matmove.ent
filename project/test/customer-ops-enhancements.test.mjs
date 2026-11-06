import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const module = await build({
  entryPoints:['src/lib/tripHistory.ts'],
  bundle:true,
  write:false,
  platform:'node',
  format:'esm',
});
const source = 'data:text/javascript;base64,' + Buffer.from(module.outputFiles[0].text).toString('base64');
const {filterTripHistory}=await import(source);

const now=Date.parse('2026-11-06T00:00:00Z');
const rows=[
  {id:'recent',status:'completed',created_at:'2026-11-01T00:00:00Z'},
  {id:'older',status:'cancelled',created_at:'2026-09-15T00:00:00Z'},
  {id:'old',status:'completed',created_at:'2026-07-01T00:00:00Z'},
  {id:'future',status:'accepted',created_at:'2026-11-20T00:00:00Z'},
  {id:'invalid',status:'completed',created_at:'not-a-date'},
];

test('recent and history filters apply exact rolling windows and retain valid future scheduled trips',()=>{
  assert.deepEqual(filterTripHistory(rows,'30','all',now).map(x=>x.id),['recent','future']);
  assert.deepEqual(filterTripHistory(rows,'90','all',now).map(x=>x.id),['recent','older','future']);
  assert.deepEqual(filterTripHistory(rows,'all','all',now).map(x=>x.id),['recent','older','old','future','invalid']);
});

test('trip status combines with time filters and never mutates the original history array',()=>{
  const original=[...rows];
  assert.deepEqual(filterTripHistory(rows,'90','completed',now).map(x=>x.id),['recent']);
  assert.deepEqual(filterTripHistory(rows,'all','cancelled',now).map(x=>x.id),['older']);
  assert.deepEqual(rows,original);
});

test('TripHistory renders accessible recent/history and status selectors using the shared filter',async()=>{
  const fs=await import('node:fs/promises');
  const component=await fs.readFile('src/components/TripHistory.tsx','utf8');
  assert.match(component,/Filter trips by time period/);
  assert.match(component,/Filter trips by status/);
  assert.match(component,/filterTripHistory\(ownedTrips,period,statusFilter\)/);
});

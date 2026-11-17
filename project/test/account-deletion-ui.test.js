import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('account deletion confirmation accepts the MatMove six-to-nine digit passcode range', async()=>{
 const source=await readFile('src/App.tsx','utf8');
 assert.match(source,/Enter your 6–9 digit passcode to confirm the deletion request/);
 assert.match(source,/maxLength=\{9\}/);
 assert.match(source,/inputMode="numeric"/);
 assert.match(source,/replace\(\/\[\^0-9\]\/g,''\)\.slice\(0,9\)/);
 assert.match(source,/deletePin\.length<6\|\|deletePin\.length>9/);
 assert.match(source,/receipt\.digits<6\|\|receipt\.digits>9/);
});

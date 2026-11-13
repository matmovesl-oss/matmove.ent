import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('customer role selection validates and formats Sierra Leone phone numbers before account setup',async()=>{
 const src=await readFile('src/pages/OnboardingPages.tsx','utf8');
 const page=src.slice(src.indexOf('export function RoleSelectionPage'),src.indexOf('export function PersonalInfoPage'));
 assert.match(src,/import \{ normalizeCustomerPhone \} from '\.\.\/\.\.\/shared\/customer-access\.js'/);
 assert.match(page,/normalizeCustomerPhone\(phone\)/);
 assert.match(page,/disabled=\{!selected \|\| !phone\.trim\(\) \|\| !phoneIsValid/);
 assert.match(page,/onBlur=\{\(\) => \{ setPhoneTouched\(true\); setPhone\(current => formatSierraLeonePhone\(current\)\); \}\}/);
 assert.match(page,/Use your Sierra Leone mobile number/);
 assert.match(page,/aria-invalid=\{!!phoneValidationMessage\}/);
 assert.match(src,/This phone number is already linked to another MatMove account/);
});

test('customer phone error messages are translated from backend codes into clear actions',async()=>{
 const src=await readFile('src/pages/OnboardingPages.tsx','utf8');
 assert.match(src,/Enter a valid Sierra Leone mobile number, for example \+232 76 000 000/);
 assert.match(src,/This phone number is already linked to another MatMove account/);
 assert.match(src,/message\.replace\(\/\^\(INVALID\|FORBIDDEN\|CONFLICT\|LOCKED\)/);
});

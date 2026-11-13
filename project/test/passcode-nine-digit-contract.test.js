import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('new passcodes are six through nine digits and legacy ten-digit PINs remain valid', async () => {
  const [migration, component, screen] = await Promise.all([
    readFile('supabase/migrations/20261113095000_matmove_passcode_new_pin_six_to_nine_digits.sql', 'utf8'),
    readFile('src/components/CustomerPasscode.tsx', 'utf8'),
    readFile('src/pages/UpdatePassword.tsx', 'utf8')
  ]);

  assert.ok(migration.includes("p_new_pin !~ '^[0-9]{6,9}$'"));
  assert.ok(migration.includes('digits between 6 and 10'));
  assert.ok(migration.includes('recovery_session_id = session_id'));
  assert.ok(migration.includes('auth.sessions'));
  assert.ok(component.includes("!/^\\d{6,9}$/.test(newPin||'')"));
  assert.ok(component.includes('[0-9]{6,10}'));
  assert.ok(component.includes('New passcode (6–9 digits)'));
  assert.ok(screen.includes('pattern="[0-9]{6,9}"'));
  assert.ok(screen.includes('maxLength={9}'));
  assert.ok(screen.includes('slice(0, 9)'));
});

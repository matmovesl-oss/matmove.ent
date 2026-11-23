import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Customer offline install precaches every Vite entry including lazy route chunks', async () => {
  const [vite, worker] = await Promise.all([
    readFile('vite.config.ts', 'utf8'),
    readFile('public/sw.js', 'utf8')
  ]);
  assert.match(vite, /manifest: 'manifest\.json'/);
  assert.match(worker, /fetch\('\/manifest\.json'/);
  assert.match(worker, /Object\.values\(manifest\)/);
  assert.match(worker, /entry\.file/);
  assert.match(worker, /entry\.css/);
  assert.match(worker, /entry\.assets/);
  assert.match(worker, /precacheBuildAssets\(cache\)/);
  assert.match(worker, /matmove-shell-v4/);
  assert.match(worker, /if \(url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(worker, /auth\|wallet\|payment\|transaction\|profile\|booking/);
  assert.doesNotMatch(worker, /cache\.put\([^\n]*(?:wallet|payment|transaction|profile|booking)Data/i);
});

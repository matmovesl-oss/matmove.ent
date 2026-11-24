import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Customer production build uses the audited Vite 8 toolchain with a matching lockfile', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  const root = lock.packages?.[''];

  assert.ok(root, 'lockfile root metadata exists');
  assert.equal(packageJson.devDependencies.vite, '^8.3.8');
  assert.equal(packageJson.devDependencies['@vitejs/plugin-react'], '^6.3.0');
  assert.equal(packageJson.devDependencies.esbuild, '^0.28.2');
  assert.deepEqual(packageJson.allowScripts, { 'esbuild@0.28.2': true });
  assert.equal(lock.packages['node_modules/vite']?.version, '8.3.8');
  assert.equal(lock.packages['node_modules/@vitejs/plugin-react']?.version, '6.3.0');
  assert.equal(lock.packages['node_modules/esbuild']?.version, '0.28.2');

  const sort = value => Object.fromEntries(Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b)));
  assert.deepEqual(sort(root.dependencies), sort(packageJson.dependencies));
  assert.deepEqual(sort(root.devDependencies), sort(packageJson.devDependencies));
  assert.doesNotMatch(packageJson.scripts.build, /vite8:preview/);
  assert.equal(packageJson.scripts['vite8:preview'], undefined);
});

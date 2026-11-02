import test from 'node:test';
import assert from 'node:assert/strict';
import * as host from '../index.js';

test('host entry stays an inert Loader stub for the browser-only panel', () => {
  assert.deepEqual(Object.keys(host), ['apply']);
  assert.equal(typeof host.apply, 'function');
  assert.equal(host.apply(), undefined);
});

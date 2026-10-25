import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import vm from 'node:vm';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('distribution has a matching lazy factory and no client package imports', () => {
  const manifest = JSON.parse(read('package.json'));
  const artifact = read('client.js');
  // Syntax compilation only: no fake browser, React or component rendering.
  assert.doesNotThrow(() => new vm.Script(artifact));
  assert.ok(artifact.includes('id: ' + JSON.stringify(manifest.name)));
  assert.deepEqual([...artifact.matchAll(/require\(["']([^"']+)["']\)/g)].map(match => match[1]), ['react']);
  assert.doesNotMatch(artifact, /document\.body|dangerouslySetInnerHTML|eval\(|new Function|https?:\/\//);
  assert.deepEqual(manifest.dsh.bundle, { patch: './cordis.patch.yml' });
  assert.ok(read('cordis.patch.yml').includes(manifest.name));
});
test('runtime exports and localized display resources exist', () => {
  const manifest = JSON.parse(read('package.json'));
  for (const name of ['.', './client', './icon']) assert.ok(existsSync(new URL('../' + manifest.exports[name], import.meta.url)));
  for (const lang of ['zh', 'en']) {
    const dictionary = JSON.parse(read('locale/' + lang + '.json'));
    assert.ok(dictionary.meta.title.length > 0);
    assert.ok(dictionary.meta.description.length > 0);
  }
  assert.ok(statSync(new URL('../icon.svg', import.meta.url)).size < 256 * 1024);
  assert.ok(read('icon.svg').startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.equal(manifest.engines.dsh, '>=0.2.1-0 <0.2.2-0');
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.scripts.postinstall, undefined);
});

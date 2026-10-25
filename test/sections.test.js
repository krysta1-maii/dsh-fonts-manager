import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const base = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const preview = readFileSync(new URL('../src/preview.css', import.meta.url), 'utf8');
function rule(css, selector) {
  const boundary = css.indexOf('\n' + selector + ' {');
  const start = css.startsWith(selector + ' {') ? 0 : boundary < 0 ? -1 : boundary + 1;
  assert.notEqual(start, -1, selector);
  return css.slice(start, css.indexOf('}', start) + 1);
}
test('redesigned surfaces and accents derive from native theme aliases', () => {
  const root = rule(base, '.dfm-page');
  assert.match(root, /container: dfm-page \/ inline-size/);
  assert.match(root, /--dfm-accent-fill: color-mix/);
  assert.match(root, /--dsw-alias-brand-primary/);
  assert.doesNotMatch(base + preview, /#[0-9a-fA-F]{3,8}\b|rgba?[(]/);
  assert.doesNotMatch(base + preview, /--(?:dsh|dsw)[\w-]+\s*:/);
});
test('editing and apply controls stick within the plugin rather than the viewport', () => {
  assert.match(rule(base, '.dfm-editor'), /position: sticky; top: 0/);
  assert.match(rule(base, '.dfm-footer'), /position: sticky; bottom: 0/);
  assert.doesNotMatch(base + preview, /position: fixed/);
  assert.ok(base.includes('.dfm-editor { position: relative; top: auto; }'));
});
test('font picker overlays layout with bounded responsive dimensions', () => {
  const css = rule(base, '.dfm-font-popover');
  assert.match(css, /position: absolute/);
  assert.match(css, /100cqi/);
  assert.match(css, /max-height:/);
  assert.ok(base.includes('.dfm-family-field { position: relative;'));
  assert.ok(base.includes('width < 760px'));
});
test('dialogs and input errors stay scoped and keyboard focus is visible', () => {
  assert.ok(base.includes('.dfm-page dialog.dfm-dialog'));
  assert.ok(base.includes(':focus-visible'));
  assert.ok(base.includes('.dfm-input-error'));
  assert.ok(base.includes('prefers-reduced-motion'));
});
test('scene typography is preserved while comparison and scrolling are reframed', () => {
  const scene = rule(preview, '.dfm-dsh-scene');
  assert.match(scene, /font-family: var\(--dfm-pv-font-text\)/);
  assert.match(scene, /font-size: var\(--dfm-pv-body\)/);
  assert.doesNotMatch(scene, /--dfm-section-(?:fill|head)/);
  assert.match(rule(preview, '.dfm-pv-scroll'), /height: clamp/);
  assert.ok(preview.includes('repeat(2, minmax(0, 1fr))'));
  assert.ok(preview.includes('width < 760px'));
});

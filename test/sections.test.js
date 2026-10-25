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
test('surfaces, accents, radii and elevation derive from native theme tokens', () => {
  const root = rule(base, '.dfm-page');
  assert.match(root, /container: dfm-page \/ inline-size/);
  assert.match(root, /--dfm-info: var\(--dsw-alias-state-business-primary/);
  assert.match(root, /--dfm-card: var\(--dsw-alias-settings-card-fill/);
  assert.match(root, /--dfm-primary: var\(--dsw-alias-button-primary-fill/);
  assert.match(root, /--dfm-r-md: var\(--dsw-radius-md/);
  assert.match(root, /--dfm-elevation: var\(--dsw-elevation-soft/);
  assert.doesNotMatch(base + preview, /#[0-9a-fA-F]{3,8}\b|rgba?[(]/);
  assert.doesNotMatch(base + preview, /--(?:dsh|dsw)[\w-]+\s*:/);
  assert.doesNotMatch(base, /font-size:\s*(?:[0-9]|10)(?:\.\d+)?px/);
});
test('keyboard focus uses the host focus ring', () => {
  assert.match(base, /:focus-visible \{\s*outline: var\(--dsw-focus-ring-width, 2px\) solid var\(--dsw-focus-ring-color/);
});
test('editing and apply controls stick within the host scroll container', () => {
  assert.match(rule(base, '.dfm-editor'), /position: sticky; top: 0/);
  assert.match(rule(base, '.dfm-footer'), /position: sticky; bottom: 0/);
  assert.doesNotMatch(base + preview, /position: fixed/);
  assert.ok(base.includes('.dfm-editor { position: relative; top: auto; z-index: auto; }'));
  assert.ok(base.includes('.dfm-footer[data-stuck]::after'));
});
test('font picker overlays layout with bounded responsive dimensions', () => {
  const css = rule(base, '.dfm-font-popover');
  assert.match(css, /position: absolute/);
  assert.match(css, /100cqi/);
  assert.match(css, /max-height:/);
  assert.ok(base.includes('.dfm-font-popover[data-placement="top"]'));
  assert.ok(base.includes('.dfm-family-field { position: relative;'));
  assert.ok(base.includes('width < 760px'));
  assert.doesNotMatch(base, /dfm-pagination/);
});
test('dialogs and input errors stay scoped and motion can be reduced', () => {
  assert.ok(base.includes('.dfm-page dialog.dfm-dialog'));
  assert.ok(base.includes('.dfm-input-error'));
  assert.ok(base.includes('prefers-reduced-motion'));
});
test('scene typography is preserved while comparison and scrolling are reframed', () => {
  const scene = rule(preview, '.dfm-dsh-scene');
  assert.match(scene, /font-family: var\(--dfm-pv-font-text\)/);
  assert.match(scene, /font-size: var\(--dfm-pv-body\)/);
  assert.doesNotMatch(scene, /--dfm-(?:card|chip|hover)/);
  assert.match(rule(preview, '.dfm-pv-scroll'), /height: clamp/);
  assert.ok(preview.includes('repeat(2, minmax(0, 1fr))'));
  assert.ok(preview.includes('width < 760px'));
});
test('chat bubble and composer follow the host specific tokens', () => {
  assert.match(rule(preview, '.dfm-pv-user-bubble'), /var\(--dsw-specific-bubble/);
  assert.match(rule(preview, '.dfm-pv-composer'), /var\(--dsw-specific-input-major/);
});

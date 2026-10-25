import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pendingChanges, mergeCatalog, stageFontEdit } from '../src/client.js';
import { previewFamily } from '../src/preview.js';
import { readTypography, typographyOperations, resetOperations } from '../shared.js';

// Pure data tests only. No browser, simulated DOM, React renderer or screenshot.
test('preview does not mutate accepted settings and normalizes family stacks', () => {
  const accepted = readTypography({ fontSize: 16, textFontFamily: '"Noto Sans CJK SC"' });
  const before = structuredClone(accepted);
  assert.deepEqual(pendingChanges(accepted, { ...accepted, text: { family: 'Noto Sans CJK SC', size: 16 } }), {});
  const draft = { ...accepted, text: { family: 'Georgia, serif', size: 18 } };
  assert.deepEqual(pendingChanges(accepted, draft), { text: { family: '"Georgia", serif', size: 18 } });
  assert.deepEqual(accepted, before);
});
test('three role drafts share one mutation and resets are not overwritten by set', () => {
  const accepted = readTypography({});
  const draft = { text: { family: 'Arial', size: 16 }, code: { family: 'Fira Code', size: 13 }, terminal: { family: '', size: 13 } };
  const changes = pendingChanges(accepted, draft, ['code']);
  assert.deepEqual(changes, { text: { family: '"Arial"', size: 16 } });
  const operations = [...typographyOperations(changes), ...resetOperations(['code'])];
  assert.deepEqual(operations.map(op => op.path[0]), ['textFontFamily', 'fontSize', 'codeFontFamily', 'codeFontSize']);
  assert.equal(operations.some(op => op.path[0] === 'preference'), false);
});
test('preview CSS has native fallback and treats a CSS payload as a quoted name', () => {
  assert.match(previewFamily('text', ''), /--dsh-font-family-text-default/);
  assert.match(previewFamily('code', 'JetBrains Mono'), /^"JetBrains Mono", var/);
  assert.equal(previewFamily('terminal', ''), 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace');
  assert.match(previewFamily('text', '\";color:red;/*'), /^";color:red;\/\*", var/);
});
test('catalog merges local names without duplicates and does not claim candidates installed', () => {
  const catalog = mergeCatalog(['arial', 'A Local Font', 'A Local Font', '', null]);
  assert.equal(catalog.filter(font => font.family.toLowerCase() === 'arial').length, 1);
  assert.equal(catalog.find(font => font.family === 'Arial').local, true);
  assert.equal(catalog.find(font => font.family === 'A Local Font').local, true);
  assert.equal(catalog.find(font => font.family === 'JetBrains Mono').local, false);
  assert.equal(catalog.find(font => font.family === 'A Local Font').category, 'other');
});
test('locale dictionaries match and source keys are translated', () => {
  const zh = JSON.parse(readFileSync(new URL('../locale/zh.json', import.meta.url))).ui;
  const en = JSON.parse(readFileSync(new URL('../locale/en.json', import.meta.url))).ui;
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
  const source = ['../src/client.js', '../src/preview.js'].map(file => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');
  for (const match of source.matchAll(/\b(?:t|fmt)\('([^']+)'/g)) assert.ok(zh[match[1]], match[1]);
  for (const dict of [zh, en]) for (const value of Object.values(dict)) assert.equal(typeof value, 'string');
});
test('client embeds configuration only in its own bundle detail page', () => {
  const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8');
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(source.includes("const PACKAGE_ID = '" + manifest.name + "'"));
  assert.ok(source.includes("ctx.configForms.whileServed(['ui-theme']"));
  assert.ok(source.includes("ctx.configForms.get('ui-theme')"));
  assert.ok(source.includes('form.mutate(ops, edit.revision)'));
  assert.ok(source.includes("ctx.slots.inject('plugins.bundle.config'"));
  assert.ok(source.includes("name: 'plugins.bundle.config', key: PACKAGE_ID"));
  assert.ok(source.includes("({ view }) => view === 'page' ? h(FontSettings"));
  assert.doesNotMatch(source, /sidebar[.]panellist|name: 'main'|ctx[.]layout|t\('close'\)|FontIcon|name: 'settings[.]|document[.]body|localStorage|fetch\(/);
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-plugin-manager'));
  assert.ok(!manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-layout'));
});
test('embedded settings leave page chrome and scrolling to the plugin manager', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const root = css.match(/[.]dfm-page\s*[{]([^}]+)[}]/)[1];
  assert.match(root, /width: 100%;/);
  assert.match(root, /padding: 0;/);
  assert.doesNotMatch(root, /height: 100%|overflow: auto|position: fixed/);
  assert.match(css, /position: sticky/);
  assert.doesNotMatch(css, /position: fixed/);
  const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /h\('h1'/);
  assert.ok(source.includes("'aria-label': t('settingsTitle')"));
});
test('styles remain scoped and use theme colors only', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@container/);
});

test('unchanged font selection never freezes a draft or revision', () => {
  const accepted = readTypography({ textFontFamily: '"Arial"', fontSize: 15 });
  assert.equal(stageFontEdit(null, accepted, 4, 'text', { family: 'Arial' }), null);
  assert.equal(stageFontEdit(null, accepted, 4, 'text', { size: 15 }), null);
});
test('reverting the last edited value follows the next external snapshot', () => {
  const accepted = readTypography({ fontSize: 15 });
  const pending = stageFontEdit(null, accepted, 4, 'text', { size: 16 });
  const reverted = stageFontEdit(pending, accepted, 4, 'text', { size: 15 });
  assert.equal(reverted, null);
  const external = readTypography({ fontSize: 17 });
  const next = stageFontEdit(reverted, external, 6, 'code', { size: 12 });
  assert.equal(next.revision, 6);
  assert.equal(next.values.text.size, 17);
  assert.deepEqual(pendingChanges(external, next.values), { code: { size: 12 } });
});
test('first actual edit after a no-op and external theme change uses the new revision', () => {
  const accepted = readTypography({ fontSize: 15 });
  const unchanged = stageFontEdit(null, accepted, 4, 'text', { family: '' });
  const edited = stageFontEdit(unchanged, accepted, 5, 'code', { family: 'Consolas' });
  assert.equal(edited.revision, 5);
});
test('an actually dirty draft keeps its original fence and other role resets', () => {
  const accepted = readTypography({});
  const pending = stageFontEdit(null, accepted, 4, 'text', { size: 17 });
  const next = stageFontEdit(pending, accepted, 5, 'code', { size: 12 });
  assert.equal(next.revision, 4);
  const reset = { values: accepted, revision: 3, resetRoles: ['terminal'] };
  const unchangedText = stageFontEdit(reset, accepted, 5, 'text', { family: '' });
  assert.equal(unchangedText.revision, 3);
  assert.deepEqual(unchangedText.resetRoles, ['terminal']);
});


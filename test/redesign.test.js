import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSizeInput, validFamilyInput, mergeCatalog, groupCatalog, fontStatus, stageFontEdit, stageFontReset, draftOperations } from '../src/client.js';
import { readTypography } from '../shared.js';

test('suggested fonts are grouped with the role-appropriate category first', () => {
  const catalog = mergeCatalog(['Unlisted Local Font']).filter(font => font.recommended);
  const order = role => groupCatalog(catalog, role).map(group => group.category);
  assert.deepEqual(order('text'), ['default', 'sans', 'serif', 'mono']);
  assert.deepEqual(order('code'), ['default', 'mono', 'sans', 'serif']);
  assert.deepEqual(order('terminal'), order('code'));
  const groups = groupCatalog(catalog, 'code');
  assert.equal(groups.reduce((sum, group) => sum + group.items.length, 0), catalog.length);
  assert.ok(groups.find(group => group.category === 'mono').items.every(font => font.category === 'mono'));
  assert.deepEqual(groupCatalog([], 'text'), []);
});

test('size input validation is independent of its editable text buffer', () => {
  for (const raw of ['', '1', '-', '1.2', 'NaN', '1e1', '23']) assert.equal(parseSizeInput('text', raw), null);
  assert.equal(parseSizeInput('text', '18'), 18);
  assert.equal(parseSizeInput('text', ' 18 '), 18);
  assert.equal(parseSizeInput('code', '17'), null);
  assert.equal(parseSizeInput('terminal', '20'), 20);
});
test('advanced input accepts separators and validates normalized length', () => {
  assert.equal(validFamilyInput('Arial,'), true);
  assert.equal(validFamilyInput('Arial, Noto Sans CJK SC'), true);
  assert.equal(validFamilyInput(''), true);
  assert.equal(validFamilyInput('a'.repeat(2048)), false);
  assert.equal(validFamilyInput(null), false);
});
test('local catalog retains unclassified fonts outside the recommendations filter', () => {
  const fonts = mergeCatalog(['Cascadia Mono', 'Unlisted Local Font']);
  assert.equal(fonts.find(font => font.family === 'Cascadia Mono').category, 'mono');
  const local = fonts.filter(font => font.local);
  assert.equal(local.length, 2);
  assert.equal(local.find(font => font.family === 'Unlisted Local Font').recommended, false);
});
test('availability never treats a catalog entry as proof of installation', () => {
  assert.equal(fontStatus('Arial', [], false), 'unverified');
  assert.equal(fontStatus('Arial', [], true), 'missing');
  assert.equal(fontStatus('Arial', ['arial'], true), 'verified');
  assert.equal(fontStatus('Arial, Missing', ['Arial'], true), 'missing');
  assert.equal(fontStatus('Arial, sans-serif', ['Arial'], true), 'verified');
  assert.equal(fontStatus('', [], false), 'defaultTag');
  assert.equal(fontStatus('monospace', [], false), 'defaultTag');
});
test('normal multi-role draft produces one font-only operation set', () => {
  const accepted = readTypography({ fontSize: 16 });
  let edit = stageFontEdit(null, accepted, 4, 'text', { size: 18 });
  edit = stageFontEdit(edit, accepted, 4, 'code', { family: 'Cascadia Mono' });
  assert.deepEqual(draftOperations(accepted, edit), [
    { op: 'set', path: ['fontSize'], value: 18 },
    { op: 'set', path: ['codeFontFamily'], value: '"Cascadia Mono"' },
  ]);
  assert.equal(edit.revision, 4);
});
test('reset followed by size edit keeps the family inherited', () => {
  const accepted = readTypography({ fontSize: 16, textFontFamily: 'Arial' });
  const inherited = readTypography({ fontSize: 14, textFontFamily: 'Georgia' });
  const reset = stageFontReset(null, accepted, inherited, 8, 'text');
  const edited = stageFontEdit(reset, accepted, 8, 'text', { size: 18 });
  assert.deepEqual(draftOperations(accepted, edited), [
    { op: 'unset', path: ['textFontFamily'] },
    { op: 'set', path: ['fontSize'], value: 18 },
  ]);
});
test('reset followed by family edit keeps size inherited and reset again removes explicit edits', () => {
  const accepted = readTypography({ fontSize: 16, textFontFamily: 'Arial' });
  const inherited = readTypography({});
  let edit = stageFontReset(null, accepted, inherited, 8, 'text');
  edit = stageFontEdit(edit, accepted, 8, 'text', { family: 'Georgia' });
  assert.deepEqual(draftOperations(accepted, edit), [
    { op: 'unset', path: ['fontSize'] },
    { op: 'set', path: ['textFontFamily'], value: '"Georgia"' },
  ]);
  edit = stageFontReset(edit, accepted, inherited, 9, 'text');
  assert.equal(edit.revision, 8);
  assert.deepEqual(draftOperations(accepted, edit), [
    { op: 'unset', path: ['textFontFamily'] }, { op: 'unset', path: ['fontSize'] },
  ]);
});

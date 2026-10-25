import test from 'node:test';
import assert from 'node:assert/strict';
import { FAMILY_MAX_LENGTH, ROLES, ROLE_SPECS, normalizeFontFamily, readTypography, typographyOperations, resetOperations } from '../shared.js';

test('roles and native field/range/default contracts are immutable', () => {
  assert.deepEqual(ROLES, ['text', 'code', 'terminal']);
  assert.deepEqual(ROLE_SPECS, {
    text: { familyField: 'textFontFamily', sizeField: 'fontSize', min: 10, max: 22, defaultSize: 14 },
    code: { familyField: 'codeFontFamily', sizeField: 'codeFontSize', min: 10, max: 16, defaultSize: 11 },
    terminal: { familyField: 'terminalFontFamily', sizeField: 'terminalFontSize', min: 10, max: 20, defaultSize: 13 },
  });
  assert.equal(FAMILY_MAX_LENGTH, 2048);
  assert.throws(() => ROLES.push('theme'), TypeError);
  assert.throws(() => { ROLE_SPECS.text.familyField = 'preference'; }, TypeError);
});

test('normalization handles Chinese, quotes, commas, and native generic keywords', () => {
  assert.equal(normalizeFontFamily(` 思源宋体 , "Noto Sans CJK SC" , 'JetBrains Mono', MONOSPACE, system-ui `),
    '"思源宋体", "Noto Sans CJK SC", "JetBrains Mono", MONOSPACE, system-ui');
  const generic = 'serif, sans-serif, monospace, cursive, fantasy, system-ui, ui-serif, ui-sans-serif, ui-monospace, ui-rounded, emoji, math, fangsong, -apple-system, BlinkMacSystemFont';
  assert.equal(normalizeFontFamily(generic), generic);
  assert.equal(normalizeFontFamily('Arial'), '"Arial"');
  assert.equal(normalizeFontFamily(` , , "" , '' , `), '');
  assert.equal(normalizeFontFamily('A  B\u00a0  C'), '"A B C"');
});

test('normalization strips native disallowed characters before collapsing whitespace', () => {
  const controls = Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)).join('') + String.fromCharCode(127);
  assert.equal(normalizeFontFamily('A' + controls + 'B'), '"AB"');
  assert.equal(normalizeFontFamily('Noto\tSans\nCJK'), '"NotoSansCJK"');
  assert.equal(normalizeFontFamily('A' + String.fromCharCode(92) + 'B<>'), '"AB"');
});

test('CSS-like input remains a single quoted family rather than a declaration', () => {
  const payload = 'X"; color:red; } body { background:url(https://example.invalid/a) } <script>alert(1)</script>';
  const result = normalizeFontFamily(payload);
  assert.equal(result, '"X; color:red; } body { background:url(https://example.invalid/a) } scriptalert(1)/script"');
  assert.equal(result.split('"').length, 3);
  assert.equal(result.includes('<'), false);
  assert.equal(result.includes('>'), false);
  assert.equal(normalizeFontFamily('var(--font), inherit, initial'), '"var(--font)", "inherit", "initial"');
});

test('normalization is idempotent and never coerces non-string input', () => {
  for (const value of ['', 'Arial, serif', '思源黑体', ' a  b , ui-monospace ', '<script>"x"</script>']) {
    const once = normalizeFontFamily(value);
    assert.equal(normalizeFontFamily(once), once);
  }
  for (const value of [undefined, null, 42, true, [], {}, new String('Arial')]) {
    assert.throws(() => normalizeFontFamily(value), TypeError);
  }
});

test('readTypography preserves raw families, ignores unrelated fields, and supplies native defaults', () => {
  const defaults = { text: { family: '', size: 14 }, code: { family: '', size: 11 }, terminal: { family: '', size: 13 } };
  for (const value of [undefined, null, [], {}, 'text', 42, Object.create({ fontSize: 22 })]) {
    assert.deepEqual(readTypography(value), defaults);
  }
  assert.deepEqual(readTypography({ preference: 'dark', textFontFamily: ' Arial, serif ', fontSize: 18, codeFontFamily: '代码', codeFontSize: 16, terminalFontSize: 20 }), {
    text: { family: ' Arial, serif ', size: 18 }, code: { family: '代码', size: 16 }, terminal: { family: '', size: 20 },
  });
  assert.deepEqual(readTypography({ textFontFamily: {}, fontSize: '14', codeFontSize: 11.5, terminalFontSize: Infinity }), defaults);
  assert.deepEqual(readTypography({ fontSize: 23, codeFontSize: 9, terminalFontSize: null }), defaults);
});

test('set operations are partial, normalized, deterministic, and never modify theme fields', () => {
  const changes = Object.freeze({ terminal: Object.freeze({ size: 18 }), text: Object.freeze({ size: 15, family: ' 思源宋体, serif ' }), code: Object.freeze({ family: '' }) });
  assert.deepEqual(typographyOperations(changes), [
    { op: 'set', path: ['textFontFamily'], value: '"思源宋体", serif' },
    { op: 'set', path: ['fontSize'], value: 15 },
    { op: 'set', path: ['codeFontFamily'], value: '' },
    { op: 'set', path: ['terminalFontSize'], value: 18 },
  ]);
  assert.equal(changes.text.family, ' 思源宋体, serif ');
  const nullRecord = Object.assign(Object.create(null), { text: Object.assign(Object.create(null), { size: 14 }) });
  assert.deepEqual(typographyOperations(nullRecord), [{ op: 'set', path: ['fontSize'], value: 14 }]);
});

test('every font size accepts exact endpoints and rejects invalid types or out-of-range values', () => {
  for (const role of ROLES) {
    const { min, max } = ROLE_SPECS[role];
    for (const size of [min, max]) assert.equal(typographyOperations({ [role]: { size } })[0].value, size);
    for (const size of [min - 1, max + 1, 14.5, NaN, Infinity, -Infinity, '14', null, true, undefined]) {
      assert.throws(() => typographyOperations({ [role]: { size } }), TypeError);
    }
  }
});

test('family limit covers raw and normalized size without silent truncation', () => {
  const family = 'a'.repeat(2046);
  assert.equal(typographyOperations({ text: { family } })[0].value.length, 2048);
  assert.equal(typographyOperations({ text: { family: '"' + family + '"' } })[0].value.length, 2048);
  for (const family of ['a'.repeat(2047), 'a'.repeat(2048), ' '.repeat(2049), null, 1, {}, undefined]) {
    assert.throws(() => typographyOperations({ text: { family } }), TypeError);
  }
});

test('strict change validation rejects unknown keys, prototypes, accessors and empty updates', () => {
  const malformed = [undefined, null, [], {}, new Date(), { body: { size: 14 } }, { preference: 'dark' }, { text: {} },
    { text: [] }, { text: null }, { text: { family: 'Arial', preference: 'dark' } }, { text: { fontSize: 14 } },
    JSON.parse('{"__proto__":{"family":"Arial"}}'), { constructor: { family: 'Arial' } },
    Object.create({ text: { size: 14 } }), { [Symbol('extra')]: 1, text: { size: 14 } },
    { text: Object.defineProperty({}, 'size', { enumerable: true, get() { throw new Error('should not execute'); } }) },
    { text: Object.defineProperty({}, 'size', { value: 14, enumerable: false }) },
  ];
  for (const changes of malformed) assert.throws(() => typographyOperations(changes), TypeError);
  assert.equal(Object.prototype.family, undefined);
});

test('reset operations touch only selected family and size fields; empty UI composition is allowed', () => {
  assert.deepEqual(resetOperations([]), []);
  assert.deepEqual(resetOperations(['terminal', 'text']), [
    { op: 'unset', path: ['textFontFamily'] }, { op: 'unset', path: ['fontSize'] },
    { op: 'unset', path: ['terminalFontFamily'] }, { op: 'unset', path: ['terminalFontSize'] },
  ]);
  assert.equal(resetOperations(ROLES).length, 6);
  for (const roles of [undefined, null, 'text', {}, ['text', 'text'], ['theme'], ['text', 'code', 'terminal', 'text'], [undefined], Array(1)]) {
    assert.throws(() => resetOperations(roles), TypeError);
  }
});

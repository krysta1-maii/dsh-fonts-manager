import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { previewMetrics, sceneStyle, referenceSettings, tokenizeCode } from '../src/preview.js';
import { readTypography } from '../shared.js';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('native typography uses distinct body, bubble, heading, table and code metrics', () => {
  assert.deepEqual(previewMetrics(readTypography({})), {
    body: 14, bodyLeading: 24, userLeading: 22,
    h2: 19, h2Leading: 28, h3: 18, h3Leading: 26,
    secondary: 13, tableLeading: 22, flowLeading: 24,
    code: 11, codeLeading: 19, codeSmallLeading: 16,
    inlineCode: 12.25, terminal: 13,
  });
});
test('DSH secondary font transition is correct across the full native text range', () => {
  for (let text = 10; text <= 22; text++) {
    const metrics = previewMetrics(readTypography({ fontSize: text }));
    assert.equal(metrics.bodyLeading, text + 10);
    assert.equal(metrics.secondary, Math.min(text - 1, Math.max(13, text - 2)));
    assert.equal(metrics.tableLeading, metrics.secondary + 9);
    assert.equal(metrics.inlineCode, text * 0.875);
    assert.equal(metrics.code, 11);
    assert.equal(metrics.terminal, 13);
  }
});
test('code and terminal sizes remain independent of text and of each other', () => {
  const values = readTypography({ fontSize: 16, codeFontSize: 14, terminalFontSize: 20 });
  const metrics = previewMetrics(values);
  assert.equal(metrics.body, 16);
  assert.equal(metrics.inlineCode, 14);
  assert.equal(metrics.code, 14);
  assert.equal(metrics.codeLeading, 22);
  assert.equal(metrics.codeSmallLeading, 19);
  assert.equal(metrics.terminal, 20);
});
test('scene styling is subtree-local and preserves all three family stacks', () => {
  const values = readTypography({ textFontFamily: 'Arial', codeFontFamily: 'Fira Code', terminalFontFamily: 'Consolas' });
  const before = structuredClone(values);
  const style = sceneStyle(values);
  assert.ok(Object.keys(style).every(key => key.startsWith('--dfm-pv-')));
  assert.match(style['--dfm-pv-font-text'], /^"Arial", var/);
  assert.match(style['--dfm-pv-font-code'], /^"Fira Code", var/);
  assert.match(style['--dfm-pv-font-terminal'], /^"Consolas", ui-monospace/);
  assert.equal(style['--dfm-pv-inlineCode'], '12.25px');
  assert.deepEqual(values, before);
});
test('applied comparison retains the actual saved sizes instead of adopting draft sizes', () => {
  const applied = readTypography({ fontSize: 15, codeFontSize: 11 });
  const draft = readTypography({ fontSize: 19, codeFontSize: 15, codeFontFamily: 'Fira Code' });
  assert.equal(referenceSettings(applied, draft, 'code', '__current__'), applied);
  assert.equal(referenceSettings(applied, draft, 'code', '__current__').code.size, 11);
});
test('alternative font comparison changes only the selected family', () => {
  const draft = readTypography({ fontSize: 16, codeFontSize: 13, terminalFontSize: 18, terminalFontFamily: 'Consolas' });
  const before = structuredClone(draft);
  const reference = referenceSettings(readTypography({}), draft, 'code', 'JetBrains Mono');
  assert.deepEqual(reference, { ...draft, code: { family: 'JetBrains Mono', size: 13 } });
  assert.deepEqual(draft, before);
});
test('display tokenizer preserves source exactly and never interprets markup', () => {
  const samples = ['', 'const n = 123; // 中文注释\nreturn true;', '"https://example.invalid"', '<img src=x onerror=alert(1)>', 'const text = "quote: \\" ok";', 'x'.repeat(4000)];
  for (const source of samples) {
    const tokens = tokenizeCode(source);
    assert.equal(tokens.map(token => token.text).join(''), source);
    assert.ok(tokens.every(token => ['plain', 'string', 'keyword', 'number', 'comment'].includes(token.kind)));
  }
  assert.equal(tokenizeCode('const value = "hello";')[0].kind, 'keyword');
  assert.ok(tokenizeCode('// comment').some(token => token.kind === 'comment'));
});
test('scene renderer cannot dispatch tools, submit messages or modify global styles', () => {
  const source = read('src/preview.js');
  assert.doesNotMatch(source, /document[.][A-Za-z_$]|window[.][A-Za-z_$]|localStorage|fetch[(]|dangerouslySetInnerHTML|innerHTML|ctx[.][A-Za-z_$]|onClick|onSubmit|onKeyDown/);
  assert.doesNotMatch(source, /h\('(button|input|textarea)'/);
  assert.ok(source.includes("'aria-label': t('previewReadonly')"));
  assert.ok(source.includes('zoom: enlarge ? 1.5 : 1'));
  assert.ok(source.includes("className: 'dfm-pv-user-bubble'"));
  assert.ok(source.includes("className: 'dfm-pv-composer'"));
  assert.ok(source.includes("className: 'dfm-pv-tool'"));
});
test('scene CSS keeps all typography roles and native chrome ratios separate', () => {
  const css = read('src/preview.css');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgba?[(]|hsla?[(]/);
  for (const role of ['text', 'code', 'terminal']) assert.ok(css.includes('var(--dfm-pv-font-' + role + ')'));
  assert.ok(css.includes('font-size: .875em;'));
  assert.ok(css.includes('font: 11px/18px var(--dfm-pv-font-text)'));
  assert.ok(css.includes('font-size: 13px; line-height: 20px;'));
  assert.ok(css.includes('min-height: 18px;'));
  assert.ok(css.includes('line-height: normal; letter-spacing: 0;'));
  assert.doesNotMatch(css, /--(?:dsh|dsw)[\w-]+\s*:/);
});
test('each locale has multiline scene samples and an explicit terminal approximation notice', () => {
  for (const lang of ['zh', 'en']) {
    const dict = JSON.parse(read('locale/' + lang + '.json')).ui;
    for (const key of ['sampleBody', 'sampleCode', 'sampleTerminal', 'pvToolOutput']) assert.ok(dict[key].includes('\n'), lang + ':' + key);
    assert.ok(dict.pvTerminalNote.includes('xterm'));
    assert.ok(dict.previewReadonly.length > 10);
  }
});

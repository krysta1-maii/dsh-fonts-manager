import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { withBrowser } from './browser-driver.mjs';
const root = resolve(import.meta.dirname, '..');
const require = createRequire(join(root, '.ui-test', 'runtime.cjs'));
let esbuild;
try { esbuild = require('esbuild'); } catch { throw new Error('Install isolated test dependencies first: npm install --prefix .ui-test --no-save --package-lock=false --ignore-scripts react@19.2.0 react-dom@19.2.0 esbuild@0.25.11'); }
const out = join(root, '.ui-test'); await mkdir(out, { recursive: true });
const bundle = await esbuild.build({ entryPoints: [join(root, 'test/browser-entry.jsx')], bundle: true, write: false, platform: 'browser', format: 'iife', nodePaths: [join(out, 'node_modules')], define: { 'process.env.NODE_ENV': '"development"' } });
const artifact = await readFile(join(root, 'client.js'), 'utf8');
const frame = await readFile(join(root, 'test/host-frame.css'), 'utf8');
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const row = (id, module) => '<li class="host-row"><span class="host-row-icon"></span><span class="host-row-main"><span class="host-row-id">' + id + '</span><span class="host-row-module">' + module + '</span></span></li>';
const page = '<div class="fixture-banner">字体管理 ' + version + ' · 正式 React 组件回归夹具 · DSH 0.2.1 主题与插件详情页外框 · 模拟设置服务，不连接 DSH</div>'
  + '<main class="host-page" id="host-page"><div class="host-detail"><div class="host-top"><span class="host-back">‹ 插件</span></div>'
  + '<div class="host-head"><span class="host-icon">Aa</span><span class="host-switch"></span></div>'
  + '<div class="host-main"><div class="host-title-row"><h3 class="host-title">可视化字体管理</h3><span class="host-tag">v' + version + '</span></div>'
  + '<p class="host-name"><code>@local/dsh-fonts-manager</code></p><p class="host-desc">在本插件详情页预览、对比并设置正文、代码和终端字体，不改动内置字体设置界面。</p></div>'
  + '<div class="host-sections"><section class="host-section" data-plugin-config><div id="root"></div></section>'
  + '<section class="host-section"><div class="host-section-head"><h4>组件</h4><span>2</span></div><ul class="host-rows">' + row('font_manager', 'index.js') + row('client', 'client.js') + '</ul></section>'
  + '<div class="host-spacer"></div></div></div></main>';
const html = '<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + frame + '</style></head><body>' + page
  + '<script>' + bundle.outputFiles[0].text.replaceAll('</script', '<\\/script') + '</script><script>' + artifact.replaceAll('</script', '<\\/script') + '</script></body></html>';
const fixturePath = join(out, 'regression.html'); await writeFile(fixturePath, html);
const checks = [];
await withBrowser(async b => {
  const ok = name => { checks.push(name); console.log('PASS', name); };
  const q = selector => JSON.stringify(selector);
  const text = selector => b.evaluate('document.querySelector(' + q(selector) + ').textContent');
  const exists = selector => b.evaluate('!!document.querySelector(' + q(selector) + ')');
  const disabled = selector => b.evaluate('document.querySelector(' + q(selector) + ').disabled');
  const count = selector => b.evaluate('document.querySelectorAll(' + q(selector) + ').length');
  const groupLabels = () => b.evaluate('[...document.querySelectorAll(".dfm-group-label")].map(x=>x.textContent)');
  const active = () => b.evaluate('document.activeElement.className');
  async function button(container, label) { await b.evaluate('([...document.querySelectorAll(' + q(container + ' button') + ')].find(x=>x.textContent.includes(' + q(label) + '))).click()'); await b.settle(); }
  async function role(index) { await b.click('.dfm-role:nth-child(' + index + ')'); }
  const wait = ms => b.evaluate('new Promise(r=>setTimeout(r,' + ms + '))');
  const host = 'document.getElementById("host-page")';
  const apply = '.dfm-actions .dfm-primary';

  await b.viewport(1440, 1000); await b.navigate(pathToFileURL(fixturePath).href);
  assert.equal(await b.evaluate('window.fixtureReady'), true);
  assert.equal(await count('.dfm-specimen'), 2);
  assert.equal(await b.evaluate('fixture.mutations().length'), 0);
  assert.equal(await disabled(apply), true);
  assert.match(await text('.dfm-page > .dfm-header h4'), /字体设置与预览/);
  assert.equal(await b.evaluate('document.querySelector(".dfm-page").dataset.fontManager'), version);
  assert.ok(await b.evaluate('document.querySelector(".dfm-page").getBoundingClientRect().width<=960'));
  assert.equal(await b.evaluate('document.querySelector(".dfm-role[aria-selected=true]").textContent.includes("正文")'), true);
  ok('artifact loads inside the DSH detail frame with real React, native heading level and no writes');

  const bubble = await b.evaluate('(()=>{const s=getComputedStyle(document.querySelector(".dfm-pv-user-bubble")).backgroundColor,c=getComputedStyle(document.querySelector(".dfm-dsh-scene")).backgroundColor;return [s,c]})()');
  assert.notEqual(bubble[0], bubble[1]);
  const smallest = await b.evaluate('Math.min(...[...document.querySelectorAll(".dfm-page *")].filter(e=>!e.closest(".dfm-dsh-scene")&&!e.closest("dialog")&&e.getClientRects().length&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())).map(e=>parseFloat(getComputedStyle(e).fontSize)))');
  assert.ok(smallest >= 11, 'smallest plugin chrome text ' + smallest);
  ok('real theme tokens: user bubble contrasts with the scene and plugin chrome text is at least 11px');

  await b.text('.dfm-number-stepper input', '16'); await b.evaluate('fixture.external({fontSize:17})'); await b.settle();
  assert.equal(await b.evaluate('document.querySelector(".dfm-number-stepper input").value'), '17');
  await b.evaluate('fixture.patch({revision:8,value:{...fixture.snapshot().value,fontSize:16}})'); await b.settle();
  ok('clean numeric editor follows external changes without stale input');
  await b.text('.dfm-number-stepper input', ''); assert.equal(await b.evaluate('document.querySelector(".dfm-number-stepper input").value'), '');
  await b.call('Input.insertText', { text: '1' }); await b.settle(); assert.equal(await b.evaluate('document.querySelector(".dfm-number-stepper input").value'), '1');
  assert.equal(await disabled(apply), true);
  assert.match(await text('.dfm-role[aria-selected=true] .dfm-role-foot'), /字号待修正/);
  await b.call('Input.insertText', { text: '7' }); await b.settle();
  await b.key('ArrowUp', 'ArrowUp', 38);
  assert.equal(await b.evaluate('document.querySelector(".dfm-number-stepper input").value'), '18');
  assert.match(await text('.dfm-specimen:not([data-reference]) .dfm-specimen-size'), /18/);
  assert.match(await text('.dfm-specimen[data-reference] .dfm-specimen-size'), /16/);
  assert.match(await text('.dfm-role[aria-selected=true] .dfm-role-size'), /16 → 18 px/);
  assert.equal(await exists('.dfm-role[aria-selected=true] .dfm-changed-dot'), true);
  ok('numeric input keeps intermediate states, arrow keys step, role tab summarizes the pending size');

  const previewTop = await b.evaluate('document.querySelector(".dfm-preview-area").getBoundingClientRect().top');
  await b.click('.dfm-font-trigger');
  assert.equal(await b.evaluate('document.querySelector(".dfm-preview-area").getBoundingClientRect().top'), previewTop);
  assert.match(await text('.dfm-font-popover'), /未验证/);
  assert.deepEqual(await groupLabels(), ['默认', '无衬线', '衬线', '等宽']);
  assert.equal(await exists('.dfm-pagination'), false);
  assert.match(await text('.dfm-font-card'), /跟随 DSH 内置字体栈/);
  assert.equal(await b.evaluate('document.activeElement.type'), 'search');
  await b.key('ArrowDown', 'ArrowDown', 40); assert.equal(await b.evaluate('document.activeElement===document.querySelectorAll(".dfm-font-card")[0]'), true);
  await b.key('ArrowDown', 'ArrowDown', 40); assert.equal(await b.evaluate('document.activeElement===document.querySelectorAll(".dfm-font-card")[1]'), true);
  await b.key('End', 'End', 35); assert.equal(await b.evaluate('document.activeElement===[...document.querySelectorAll(".dfm-font-card")].at(-1)'), true);
  await b.key('Escape'); assert.equal(await exists('.dfm-font-popover'), false);
  assert.equal(await active(), 'dfm-font-trigger');
  ok('picker overlays without layout shift, groups text fonts, arrow keys move and Escape restores focus');

  await b.click('.dfm-advanced-trigger'); await b.text('dialog[open] input', 'Arial'); await b.call('Input.insertText', { text: ',' }); await b.settle();
  assert.equal(await b.evaluate('document.querySelector("dialog[open] input").value'), 'Arial,');
  await b.call('Input.insertText', { text: ' Noto Sans CJK SC' }); await button('dialog[open]', '完成');
  assert.match(await text('.dfm-selected-family'), /Arial, Noto Sans CJK SC/);
  assert.equal(await b.evaluate('fixture.mutations().length'), 0);
  await b.click(apply);
  const mutation = await b.evaluate('fixture.mutations()[0]'); assert.equal(mutation.revision, 8);
  assert.deepEqual(mutation.ops, [{ op: 'set', path: ['textFontFamily'], value: '"Arial", "Noto Sans CJK SC"' }, { op: 'set', path: ['fontSize'], value: 18 }]);
  assert.equal(await b.evaluate('fixture.snapshot().value.preference'), 'light'); assert.equal(await b.evaluate('fixture.snapshot().value.sentinel'), 'preserve');
  assert.match(await text('.dfm-success'), /已应用/);
  await wait(5300); await b.settle(); assert.equal(await exists('.dfm-success'), false);
  ok('custom stack keeps typed commas; apply is one revision-fenced font-only mutation; success notice dismisses itself');

  await role(2); assert.match(await text('.dfm-scene-label'), /代码/);
  assert.equal(await b.evaluate('document.querySelector(".dfm-controls").getAttribute("aria-labelledby")===document.querySelector(".dfm-role:nth-child(2)").id'), true);
  await b.click('.dfm-font-trigger'); assert.deepEqual((await groupLabels()).slice(0, 2), ['默认', '等宽']); await b.key('Escape');
  await b.click('.dfm-number-stepper button:last-child');
  await b.evaluate('fixture.setMode("reject")'); await b.click(apply); assert.match(await text('.dfm-error'), /草稿已保留/); assert.equal(await disabled(apply), false);
  await b.evaluate('fixture.setMode("accept")'); await b.click(apply);
  await role(3); assert.equal(await count('.dfm-pv-terminal-screen'), 2); await b.click('.dfm-number-stepper button:last-child');
  await b.evaluate('fixture.setMode("throw")'); await b.click(apply); assert.match(await text('.dfm-error'), /Fixture transport failure/);
  ok('code and terminal roles list monospace first; failed writes preserve editable drafts');

  await b.evaluate('fixture.external({fontSize:15})'); await b.settle(); assert.equal(await disabled(apply), true);
  await button('.dfm-warning', '重新载入'); await button('dialog[open]', '继续编辑'); assert.equal(await exists('dialog[open]'), false);
  await button('.dfm-warning', '重新载入'); await button('dialog[open]', '放弃修改并重新载入'); assert.equal(await disabled(apply), true);
  assert.match(await text('.dfm-pending-title'), /一致/); ok('conflict blocks writes and discard requires explicit confirmation');

  const user = await b.evaluate('fixture.snapshot().user');
  await b.evaluate('fixture.patch({user:{}})'); await b.settle(); assert.equal(await disabled('.dfm-restore-trigger'), true);
  await b.evaluate('fixture.patch({user:' + JSON.stringify(user) + '})'); await b.settle();
  await b.evaluate('fixture.setMode("accept")'); await role(2); assert.equal(await disabled('.dfm-restore-trigger'), false);
  await b.click('.dfm-restore-trigger'); assert.equal(await exists('.dfm-reset-note'), true); assert.equal(await disabled('.dfm-restore-trigger'), true);
  await b.click('.dfm-number-stepper button:last-child'); await b.click(apply);
  assert.deepEqual(await b.evaluate('fixture.mutations().at(-1).ops'), [{ op: 'unset', path: ['codeFontFamily'] }, { op: 'set', path: ['codeFontSize'], value: 12 }]);
  ok('restore is offered only for overridden roles; reset plus size edit keeps family inheritance');

  const locals = ['Cascadia Mono', 'Unclassified Local Font', ...Array.from({ length: 73 }, (_, index) => 'Local Font ' + String(index).padStart(2, '0'))];
  await b.click('.dfm-font-trigger'); await button('.dfm-filters', '本机'); assert.match(await text('.dfm-empty'), /尚未读取/);
  await b.evaluate('fixture.localFonts(' + JSON.stringify(locals) + ')'); await button('.dfm-picker-header', '读取本机');
  assert.equal(await count('.dfm-font-card'), 60); assert.match(await text('.dfm-show-more'), /15/);
  assert.doesNotMatch(await text('.dfm-font-list'), /Unclassified Local Font/);
  await b.click('.dfm-show-more'); assert.equal(await count('.dfm-font-card'), 75); assert.equal(await exists('.dfm-show-more'), false);
  assert.match(await text('.dfm-font-list'), /Unclassified Local Font/); assert.match(await text('.dfm-font-list'), /本机可用/);
  await b.key('Escape'); ok('local authorization lists every family in batches, including unclassified fonts');

  await b.evaluate('fixture.patch({writable:false})'); await b.settle(); await b.click('.dfm-number-stepper button:last-child');
  assert.equal(await disabled(apply), true); assert.match(await text('.dfm-warning'), /只读/); await b.evaluate('fixture.patch({writable:true})'); await b.settle();
  await b.evaluate('fixture.unmount();fixture.mount()'); await b.settle(); assert.match(await text('.dfm-pending-title'), /待应用/);
  assert.equal(await b.evaluate('document.querySelector(".dfm-role[aria-selected=true]").textContent.includes("代码")'), true);
  ok('read-only connections preview safely and route remount retains staged edits and role');
  await b.evaluate('fixture.setMode("defer")'); await b.click(apply); await b.evaluate('fixture.unmount();fixture.mount()'); await b.settle(); assert.equal(await disabled(apply), true);
  await b.evaluate('fixture.release()'); await b.settle(); assert.match(await text('.dfm-pending-title'), /一致/); ok('in-flight save remains serialized across component remount');
  await b.click('.dfm-restore-trigger');
  await b.evaluate('fixture.setMode("defer")'); await b.click(apply);
  await b.evaluate('fixture.unmount();fixture.mount()'); await b.settle(); await b.evaluate('fixture.release()'); await b.settle();
  assert.match(await text('.dfm-pending-title'), /一致/); assert.equal(await exists('.dfm-warning'), false);
  ok('successful in-flight reset clears retained reset intents after remount');

  await b.evaluate('fixture.setMode("accept")'); await role(1); await b.text('.dfm-number-stepper input', '20');
  const panes = 'document.querySelectorAll(".dfm-pv-scroll")';
  const ratio = index => b.evaluate('(p=>p.scrollTop/(p.scrollHeight-p.clientHeight))(' + panes + '[' + index + '])');
  await b.evaluate(panes + '[1].scrollTop=300'); await b.settle(); await b.settle();
  assert.ok(Math.abs(await ratio(0) - await ratio(1)) < .02, 'draft → reference sync');
  await b.evaluate(panes + '[0].scrollTop=1e6'); await b.settle(); await b.settle();
  assert.ok(await ratio(1) > .98, 'reference → draft sync');
  await role(2); assert.deepEqual(await b.evaluate('[...' + panes + '].map(p=>p.scrollTop)'), [0, 0]); await role(1);
  ok('comparison panes scroll together by relative position and reset when the role changes');

  await b.viewport(1440, 760);
  await b.evaluate('(()=>{const h=' + host + ',p=document.querySelector(".dfm-page");h.scrollTop+=p.getBoundingClientRect().top-h.getBoundingClientRect().top+120})()'); await b.settle();
  const sticky = await b.evaluate('(()=>{const hp=' + host + ',h=hp.getBoundingClientRect(),e=document.querySelector(".dfm-editor").getBoundingClientRect(),f=document.querySelector(".dfm-footer"),p=document.querySelector(".dfm-page").getBoundingClientRect(),pad=parseFloat(getComputedStyle(hp).paddingBottom);return {top:e.top-h.top,bottom:h.bottom-f.getBoundingClientRect().bottom,pad,stuck:f.hasAttribute("data-stuck"),covered:!!document.elementFromPoint(h.left+h.width/2,h.bottom-6)?.closest(".dfm-footer"),pageTop:p.top-h.top,pageBottom:p.bottom-h.bottom}})()');
  assert.ok(sticky.pageTop < 0 && sticky.pageBottom > 0, 'section must overflow both edges ' + JSON.stringify(sticky));
  assert.ok(Math.abs(sticky.top) <= 1 && Math.abs(sticky.bottom - sticky.pad) <= 1 && sticky.stuck && sticky.covered, JSON.stringify(sticky));
  await b.shot(join(out, 'production-sticky.png'));
  await b.evaluate('(()=>{const h=' + host + ',p=document.querySelector(".dfm-page");h.scrollTop+=p.getBoundingClientRect().bottom-h.getBoundingClientRect().bottom+200})()'); await b.settle(); await b.settle();
  assert.equal(await b.evaluate('document.querySelector(".dfm-footer").hasAttribute("data-stuck")'), false);
  await b.evaluate(host + '.scrollTop=0'); await b.viewport(1440, 1000);
  await button('.dfm-actions', '撤销全部'); await button('dialog[open]', '放弃修改并重新载入'); assert.match(await text('.dfm-pending-title'), /一致/);
  ok('editor and apply bar stick within the Host page scroll container');

  await b.evaluate('fixture.language("en")'); await b.settle(); assert.match(await text('.dfm-header'), /Font settings/);
  for (const width of [1280, 960, 760, 390, 320]) {
    await b.viewport(width, 900); await b.click('.dfm-font-trigger');
    const geometry = await b.evaluate('(()=>{const r=document.querySelector(".dfm-font-popover").getBoundingClientRect(),h=' + host + ',o=s=>{const e=document.querySelector(s);return e.scrollWidth-e.clientWidth};return {w:innerWidth,scroll:document.documentElement.scrollWidth,host:h.scrollWidth-h.clientWidth,l:r.left,r:r.right,b:r.bottom,roles:o(".dfm-roles"),toolbar:o(".dfm-preview-toolbar"),footer:o(".dfm-footer-row")}})()');
    assert.equal(geometry.w, width); assert.ok(geometry.scroll <= width && geometry.host <= 0, 'overflow at ' + width + ' ' + JSON.stringify(geometry));
    assert.ok(geometry.l >= 0 && geometry.r <= width && geometry.b <= 900, 'picker at ' + width + ' ' + JSON.stringify(geometry));
    assert.ok(geometry.roles <= 0 && geometry.toolbar <= 0 && geometry.footer <= 0, 'inner overflow at ' + width + ' ' + JSON.stringify(geometry));
    await b.key('Escape');
    assert.equal(await b.evaluate('(r=>!!document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest(".dfm-footer"))(document.querySelector(".dfm-pending-title").getBoundingClientRect())'), true, 'footer status visible at ' + width);
  }
  ok('English layout, role tabs, toolbar and font overlay fit 1280/960/760/390/320px');

  await b.evaluate('fixture.language("zh");fixture.external({textFontFamily:"Noto Sans CJK SC",fontSize:16})'); await b.settle(); await role(1); await b.text('.dfm-number-stepper input', '18');
  await b.viewport(1440, 1000); await b.evaluate(host + '.scrollTop=0'); await b.shot(join(out, 'production-component.png'));
  await b.click('.dfm-font-trigger'); await b.shot(join(out, 'production-picker.png')); await b.key('Escape');
  await b.evaluate('document.body.setAttribute("data-ds-dark-theme","")'); await b.shot(join(out, 'production-dark.png'));
  await b.click('.dfm-font-trigger'); await b.shot(join(out, 'production-dark-picker.png')); await b.key('Escape');
  await b.evaluate('document.body.removeAttribute("data-ds-dark-theme")');
  await b.viewport(390, 844); await b.shot(join(out, 'production-mobile.png'));
  await b.viewport(1440, 1000);

  await b.evaluate('fixture.unmount()'); await b.settle();
  await b.evaluate(host + '.scrollTop=99999'); assert.ok(await b.evaluate(host + '.scrollTop>0'));
  await b.evaluate('fixture.patch({status:"loading"})'); await b.settle();
  await b.evaluate('fixture.mount()'); await b.settle();
  assert.equal(await b.evaluate(host + '.scrollTop'), 0); assert.equal(await exists('.dfm-placeholder .dfm-spinner'), true);
  await b.evaluate('fixture.patch({status:"ready"})'); await b.settle();
  assert.equal(await b.evaluate(host + '.scrollTop'), 0);
  ok('host entry scroll resets to top before the loading placeholder expands');
  assert.equal(b.errors.length, 0, JSON.stringify(b.errors)); assert.equal(b.requests.filter(x => /^https?:/.test(x)).length, 0); ok('no browser errors or network/DSH requests; light/dark/picker/sticky/mobile screenshots rendered');
  await writeFile(join(out, 'verification.json'), JSON.stringify({ checks, browserErrors: b.errors, networkRequests: b.requests, note: 'Real React and actual generated plugin artifact inside a DSH 0.2.1 token and detail-page frame. Mock settings service only; not an authenticated DSH page.' }, null, 2));
});
console.log('Browser regression passed:', checks.length, 'checks');

import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
export async function withBrowser(callback) {
  const profile = await mkdtemp(join(tmpdir(), 'dsh-font-test-'));
  await mkdir(join(profile, 'config')); await mkdir(join(profile, 'cache'));
  const chrome = spawn(process.env.CHROME_BIN || '/usr/bin/google-chrome', [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-background-networking',
    '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank',
  ], { env: { ...process.env, XDG_CONFIG_HOME: join(profile, 'config'), XDG_CACHE_HOME: join(profile, 'cache') }, stdio: ['ignore', 'ignore', 'pipe'] });
  const exited = new Promise(resolve => chrome.once('exit', resolve));
  let ws, sessionId, seq = 0, log = '';
  const pending = new Map(), events = new Map(), errors = [], requests = [];
  const deadline = setTimeout(() => chrome.kill('SIGKILL'), 120000);
  function call(method, params = {}, session = true) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 20000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params, ...(session && sessionId ? { sessionId } : {}) }));
    });
  }
  async function evaluate(expression) {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  async function settle() { await evaluate('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))'); }
  function event(name) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Event timeout: ' + name)), 20000);
      events.set(name, value => { clearTimeout(timer); resolve(value); });
    });
  }
  try {
    const endpoint = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No CDP endpoint: ' + log.slice(-2000))), 20000);
      chrome.stderr.on('data', chunk => { log += chunk; const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
      chrome.once('error', reject); chrome.once('exit', () => { clearTimeout(timer); reject(new Error('Chrome exited: ' + log.slice(-2000))); });
    });
    ws = new WebSocket(endpoint);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    ws.onmessage = message => {
      const value = JSON.parse(message.data);
      if (value.id) {
        const item = pending.get(value.id); if (!item) return;
        clearTimeout(item.timer); pending.delete(value.id);
        value.error ? item.reject(new Error(JSON.stringify(value.error))) : item.resolve(value.result);
      } else {
        if (value.method === 'Runtime.exceptionThrown') errors.push(value.params);
        if (value.method === 'Runtime.consoleAPICalled' && value.params.type === 'error') errors.push(value.params);
        if (value.method === 'Network.requestWillBeSent') requests.push(value.params.request.url);
        const listener = events.get(value.method); if (listener) { events.delete(value.method); listener(value.params); }
      }
    };
    const target = await call('Target.createTarget', { url: 'about:blank' }, false);
    sessionId = (await call('Target.attachToTarget', { targetId: target.targetId, flatten: true }, false)).sessionId;
    await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
    const api = {
      call, evaluate, settle, errors, requests,
      async viewport(width, height) { await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); await settle(); },
      async navigate(url) { const loaded = event('Page.loadEventFired'); await call('Page.navigate', { url }); await loaded; await settle(); },
      async click(selector) { await evaluate('document.querySelector(' + JSON.stringify(selector) + ').click()'); await settle(); },
      async text(selector, text) { await evaluate('document.querySelector(' + JSON.stringify(selector) + ').focus();document.querySelector(' + JSON.stringify(selector) + ').select()'); await call('Input.insertText', { text }); await settle(); },
      async key(key, code = key, keyCode = 27) { await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode }); await settle(); },
      async shot(path) { await settle(); const image = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(path, Buffer.from(image.data, 'base64')); },
    };
    await callback(api);
  } finally {
    clearTimeout(deadline); if (ws) ws.close();
    for (const item of pending.values()) clearTimeout(item.timer);
    chrome.kill('SIGTERM'); const force = setTimeout(() => chrome.kill('SIGKILL'), 3000); await exited; clearTimeout(force);
    const canonical = await realpath(profile);
    if (!canonical.startsWith(resolve(tmpdir()) + '/dsh-font-test-')) throw new Error('Unexpected temporary profile path');
    console.log('Clean temporary Chrome profile:', canonical); await rm(canonical, { recursive: true, force: true });
  }
}

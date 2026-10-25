import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
const initial = {
  preference: 'light', textFontFamily: 'Noto Sans CJK SC', fontSize: 16,
  codeFontFamily: 'DejaVu Sans Mono', codeFontSize: 11,
  terminalFontFamily: 'DejaVu Sans Mono', terminalFontSize: 13, sentinel: 'preserve',
};
const base = { ...initial, textFontFamily: '', fontSize: 14, codeFontFamily: '', terminalFontFamily: '' };
let snapshot = { status: 'ready', writable: true, revision: 8, value: { ...initial }, base, user: { textFontFamily: initial.textFontFamily, fontSize: 16, codeFontFamily: initial.codeFontFamily, terminalFontFamily: initial.terminalFontFamily } };
const subscriptions = new Set();
const mutationLog = [];
let mode = 'accept', language = 'zh', renderer, root, dictionaries, releaseWrite;
const localeListeners = new Set();
let localeSnapshot = { revision: 0 };
function emit() { for (const listener of subscriptions) listener(); }
const form = {
  getSnapshot: () => snapshot,
  subscribe: listener => { subscriptions.add(listener); return () => subscriptions.delete(listener); },
  async mutate(ops, revision) {
    mutationLog.push({ ops: structuredClone(ops), revision });
    if (mode === 'defer') await new Promise(resolve => { releaseWrite = resolve; });
    if (mode === 'reject' || revision !== snapshot.revision) return false;
    if (mode === 'throw') throw new Error('Fixture transport failure');
    const next = structuredClone(snapshot);
    for (const op of ops) {
      const key = op.path[0];
      if (op.op === 'set') { next.value[key] = op.value; next.user[key] = op.value; }
      else { next.value[key] = next.base[key]; delete next.user[key]; }
    }
    next.revision++; snapshot = next; emit(); return true;
  },
};
const locale = {
  register(ns, lang, dict) { dictionaries ??= {}; dictionaries[lang] = dict; return () => {}; },
  bind: () => key => dictionaries[language][key] ?? key,
  subscribe: listener => { localeListeners.add(listener); return () => localeListeners.delete(listener); },
  getSnapshot: () => localeSnapshot,
};
const ctx = {
  locale, effect: callback => callback(),
  configForms: { get: () => form, whileServed: (names, callback) => callback() },
  slots: { inject: (name, callback) => callback(), register: (options, callback) => { renderer = callback; return () => {}; } },
};
function mount() { root = createRoot(document.getElementById('root')); flushSync(() => root.render(renderer({ view: 'page' }))); }
window.__ModuleLoader__ = {
  load({ id, factory }) {
    if (id !== '@local/dsh-fonts-manager') throw new Error('Unexpected plugin');
    const plugin = factory(name => { if (name !== 'react') throw new Error('Unexpected import'); return React; });
    plugin.apply(ctx); mount(); window.fixtureReady = true;
  },
};
window.fixture = {
  snapshot: () => structuredClone(snapshot), mutations: () => structuredClone(mutationLog),
  setMode: value => { mode = value; },
  release: () => { releaseWrite?.(); releaseWrite = null; },
  patch: patch => { snapshot = { ...snapshot, ...patch }; emit(); },
  external: fields => { snapshot = { ...snapshot, revision: snapshot.revision + 1, value: { ...snapshot.value, ...fields } }; emit(); },
  unmount: () => { flushSync(() => root.unmount()); }, mount,
  language: value => { language = value; localeSnapshot = { revision: localeSnapshot.revision + 1 }; localeListeners.forEach(fn => fn()); },
  localFonts: names => { window.queryLocalFonts = async () => names.map(family => ({ family })); },
};

import { ROLES, ROLE_SPECS, FAMILY_MAX_LENGTH, normalizeFontFamily, readTypography, typographyOperations, resetOperations } from '../shared.js';
import { previewFamily, createSceneRenderer } from './preview.js';

const PACKAGE_ID = '@local/dsh-fonts-manager';
const LOCALE_NS = 'dsh.fonts-manager';
const CATALOG = [
  ['', 'default'], ['system-ui', 'sans'], ['Noto Sans CJK SC', 'sans'],
  ['Source Han Sans SC', 'sans'], ['Microsoft YaHei', 'sans'], ['PingFang SC', 'sans'],
  ['WenQuanYi Micro Hei', 'sans'], ['Arial', 'sans'], ['Inter', 'sans'],
  ['Noto Serif CJK SC', 'serif'], ['Source Han Serif SC', 'serif'], ['SimSun', 'serif'],
  ['LXGW WenKai', 'serif'], ['Georgia', 'serif'], ['Times New Roman', 'serif'],
  ['JetBrains Mono', 'mono'], ['Fira Code', 'mono'], ['Cascadia Code', 'mono'], ['Cascadia Mono', 'mono'],
  ['Source Code Pro', 'mono'], ['DejaVu Sans Mono', 'mono'], ['Liberation Mono', 'mono'],
  ['Consolas', 'mono'], ['Menlo', 'mono'], ['monospace', 'mono'],
].map(([family, category]) => ({ family, category }));
const CATEGORY_ORDER = Object.freeze({
  text: ['default', 'sans', 'serif', 'mono', 'other'],
  code: ['default', 'mono', 'sans', 'serif', 'other'],
  terminal: ['default', 'mono', 'sans', 'serif', 'other'],
});
// Each rendered option loads its own font face, so long local lists grow in batches.
const LOCAL_BATCH = 60;
const SAVED_NOTICE_MS = 5000;

export function pendingChanges(accepted, draft, resetRoles = []) {
  const changes = {};
  for (const role of ROLES) {
    if (resetRoles.includes(role)) continue;
    const family = normalizeFontFamily(draft[role].family);
    const change = {};
    if (family !== normalizeFontFamily(accepted[role].family)) change.family = family;
    if (draft[role].size !== accepted[role].size) change.size = draft[role].size;
    if (Object.keys(change).length) changes[role] = change;
  }
  return changes;
}

// This function stages complete values, never an in-progress input string.
export function stageFontEdit(previous, accepted, revision, role, patch) {
  const start = previous || { values: accepted, base: accepted, revision, resetRoles: [] };
  const values = { ...start.values, [role]: { ...start.values[role], ...patch } };
  const resetRoles = start.resetRoles;
  const resetEdits = { ...start.resetEdits };
  // Editing one field after restoring defaults must not undo the other field's unset.
  if (resetRoles.includes(role)) resetEdits[role] = { ...resetEdits[role], ...patch };
  if (!resetRoles.length && !Object.keys(pendingChanges(accepted, values)).length) return null;
  return { ...start, values, resetRoles, resetEdits };
}

export function stageFontReset(previous, accepted, inherited, revision, role) {
  const start = previous || { values: accepted, base: accepted, revision, resetRoles: [] };
  const resetEdits = { ...start.resetEdits };
  delete resetEdits[role];
  return {
    ...start, values: { ...start.values, [role]: inherited[role] },
    resetRoles: [...new Set([...start.resetRoles, role])], resetEdits,
  };
}

export function draftOperations(accepted, edit) {
  if (!edit) return [];
  const changes = pendingChanges(accepted, edit.values, edit.resetRoles);
  const explicit = edit.resetEdits || {};
  const resetSets = Object.keys(explicit).length ? typographyOperations(explicit) : [];
  const explicitPaths = new Set(resetSets.map(op => op.path[0]));
  return [
    ...(Object.keys(changes).length ? typographyOperations(changes) : []),
    ...resetOperations(edit.resetRoles).filter(op => !explicitPaths.has(op.path[0])),
    ...resetSets,
  ];
}

export function parseSizeInput(role, raw) {
  const spec = ROLE_SPECS[role];
  if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw.trim());
  return Number.isInteger(value) && value >= spec.min && value <= spec.max ? value : null;
}

export function validFamilyInput(raw) {
  return typeof raw === 'string' && raw.length <= FAMILY_MAX_LENGTH
    && normalizeFontFamily(raw).length <= FAMILY_MAX_LENGTH;
}

export function mergeCatalog(localFamilies) {
  const names = new Map(CATALOG.map(item => [item.family.toLowerCase(), { ...item, local: false, recommended: true }]));
  for (const family of localFamilies) {
    if (typeof family !== 'string' || !family.trim() || family.length > FAMILY_MAX_LENGTH) continue;
    const key = family.toLowerCase();
    const known = names.get(key);
    names.set(key, known ? { ...known, local: true } : { family, category: 'other', local: true, recommended: false });
  }
  return [...names.values()];
}

export function groupCatalog(items, role) {
  return CATEGORY_ORDER[role]
    .map(category => ({ category, items: items.filter(item => item.category === category) }))
    .filter(group => group.items.length > 0);
}

export function fontStatus(family, localFamilies, localRead) {
  const names = normalizeFontFamily(family).split(',').map(name => name.trim().replaceAll('"', '')).filter(Boolean);
  const generic = name => /^(system-ui|sans-serif|serif|monospace|ui-monospace|ui-sans-serif|ui-serif|cursive|fantasy|emoji|math|fangsong)$/i.test(name);
  if (!names.length || names.every(generic)) return 'defaultTag';
  if (!localRead) return 'unverified';
  const available = new Set(localFamilies.map(name => name.toLowerCase()));
  return names.every(name => generic(name) || available.has(name.toLowerCase())) ? 'verified' : 'missing';
}

export function createPlugin(React, assets) {
  const h = React.createElement;
  const Fragment = React.Fragment;
  const DshScene = createSceneRenderer(React);
  const { useState, useMemo, useCallback, useSyncExternalStore, useRef, useEffect, useLayoutEffect, useId } = React;
  // In-memory, scoped to this Client plugin and native form; no browser/profile persistence.
  const drafts = new WeakMap();
  const writes = new WeakMap();
  const paths = {
    check: 'm5 12 4 4 10-10', down: 'm7 10 5 5 5-5', arrow: 'M5 12h14m-5-5 5 5-5 5',
    code: 'm8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 20', terminal: 'm4 6 6 6-6 6m10 0h6',
    sliders: 'M4 7h6m4 0h6M4 17h10m4 0h2M10 5h4v4h-4zM14 15h4v4h-4z',
    close: 'm6 6 12 12M6 18 18 6', monitor: 'M3 4h18v13H3zM12 17v4m-4 0h8',
    search: 'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0Zm-1 5 5 5',
    undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
    edit: 'M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4',
    alert: 'M12 9v4m0 3.5v.01M10.3 4 2.7 17.5a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0Z',
  };
  const STATUS_TONE = { verified: 'success', missing: 'warning', unverified: 'neutral', defaultTag: 'neutral' };
  const SCENE_KEY = { text: 'sceneText', code: 'sceneCode', terminal: 'sceneTerminal' };
  function Icon({ name }) {
    return h('svg', { className: 'dfm-icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: paths[name] }));
  }
  const icon = name => h(Icon, { name });
  function Dialog({ open, title, closeLabel, onClose, children, busy = false }) {
    const ref = useRef(null);
    const id = useId();
    useEffect(() => {
      const dialog = ref.current;
      if (open && !dialog.open) dialog.showModal();
      if (!open && dialog.open) dialog.close();
    }, [open]);
    return h('dialog', {
      ref, className: 'dfm-dialog', 'aria-labelledby': id,
      onCancel: event => { event.preventDefault(); if (!busy) onClose(); },
    }, h('div', { className: 'dfm-dialog-header' }, h('h2', { id }, title),
      h('button', { type: 'button', className: 'dfm-icon-button', onClick: onClose, disabled: busy, 'aria-label': closeLabel }, icon('close'))), children);
  }
  function moveOptionFocus(list, key, from) {
    const options = [...list.querySelectorAll('.dfm-font-card:not(:disabled)')];
    if (!options.length) return false;
    const index = options.indexOf(from);
    const next = key === 'Home' ? 0 : key === 'End' ? options.length - 1
      : key === 'ArrowDown' ? Math.min(options.length - 1, index + 1) : Math.max(0, index - 1);
    options[next].focus();
    return true;
  }
  function FontSettings({ form, locale, t }) {
    const subscribe = useCallback(fn => form.subscribe(fn), [form]);
    const getSnapshot = useCallback(() => form.getSnapshot(), [form]);
    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const localeSnapshot = useSyncExternalStore(useCallback(fn => locale.subscribe(fn), [locale]), useCallback(() => locale.getSnapshot(), [locale]));
    const accepted = useMemo(() => readTypography(snapshot.value || {}), [snapshot.value]);
    const [role, setRole] = useState(() => drafts.get(form)?.role || 'text');
    const [edit, setEdit] = useState(() => drafts.get(form)?.edit || null);
    const [sizeInputs, setSizeInputs] = useState(() => drafts.get(form)?.sizeInputs || {});
    const enteringWrite = useMemo(() => writes.get(form), [form]);
    const [busy, setBusy] = useState(() => !!enteringWrite);
    const busyRef = useRef(false);
    const alive = useRef(true);
    const retained = useRef(null);
    const [notice, setNotice] = useState(null);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [pickerFit, setPickerFit] = useState(null);
    const pickerRef = useRef(null);
    const triggerRef = useRef(null);
    const searchRef = useRef(null);
    const listRef = useRef(null);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState('recommended');
    const [localLimit, setLocalLimit] = useState(LOCAL_BATCH);
    const [localFamilies, setLocalFamilies] = useState([]);
    const [localRead, setLocalRead] = useState(false);
    const [localBusy, setLocalBusy] = useState(false);
    const localBusyRef = useRef(false);
    const [localNotice, setLocalNotice] = useState(null);
    const [compare, setCompare] = useState(true);
    const [enlarge, setEnlarge] = useState(false);
    const [samples, setSamples] = useState({ text: '', code: '', terminal: '' });
    const [modal, setModal] = useState(null);
    const [familyText, setFamilyText] = useState('');
    const [familyError, setFamilyError] = useState(false);
    const familyStart = useRef(null);
    const [sampleText, setSampleText] = useState('');
    const ids = useId();
    const pageRef = useRef(null);
    const gridRef = useRef(null);
    const endRef = useRef(null);
    const scrollRoot = useRef(null);
    const [footerStuck, setFooterStuck] = useState(false);
    // The plugin manager reuses its scroll container across list and detail;
    // reset it before the loading placeholder expands and scroll anchoring chases the bottom.
    useLayoutEffect(() => {
      for (let node = pageRef.current?.parentElement; node; node = node.parentElement) {
        const overflowY = getComputedStyle(node).overflowY;
        if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
          node.scrollTop = 0;
          scrollRoot.current = node;
          break;
        }
      }
    }, []);
    const values = edit?.values || accepted;
    const resets = edit?.resetRoles || [];
    const changes = pendingChanges(accepted, values, resets);
    const changedRoles = ROLES.filter(item => Object.hasOwn(changes, item) || resets.includes(item));
    const dirty = changedRoles.length > 0;
    const invalidSizes = ROLES.filter(item => Object.hasOwn(sizeInputs, item) && parseSizeInput(item, sizeInputs[item]) === null);
    const hasPending = dirty || invalidSizes.length > 0;
    const conflict = !!edit && dirty && edit.revision !== snapshot.revision;
    const ready = snapshot.status === 'ready';
    const canEdit = ready && !busy;
    const selected = values[role];
    const spec = ROLE_SPECS[role];
    const fmt = (key, replacements) => Object.entries(replacements).reduce((text, [name, value]) => text.replaceAll('{' + name + '}', String(value)), t(key));
    const label = family => normalizeFontFamily(family).replaceAll('"', '') || t('builtin');
    const catalog = useMemo(() => mergeCatalog(localFamilies), [localFamilies]);
    const query = search.toLowerCase().trim();
    const matches = useMemo(() => {
      const found = catalog.filter(item => (filter === 'local' ? item.local : item.recommended)
        && (item.family || t('builtin')).toLowerCase().includes(query));
      return filter === 'local' ? found.sort((a, b) => a.family.localeCompare(b.family)) : found;
    }, [catalog, query, filter, t, localeSnapshot.revision]);
    const groups = filter === 'local' ? [{ category: 'local', items: matches.slice(0, localLimit) }] : groupCatalog(matches, role);
    const hiddenCount = filter === 'local' ? Math.max(0, matches.length - localLimit) : 0;
    const selectedFamily = normalizeFontFamily(selected.family);
    const selectedStatus = fontStatus(selected.family, localFamilies, localRead);
    const user = snapshot.user;
    const overridden = item => !user || typeof user !== 'object'
      || Object.hasOwn(user, ROLE_SPECS[item].familyField) || Object.hasOwn(user, ROLE_SPECS[item].sizeField);
    const canRestore = canEdit && !resets.includes(role) && (overridden(role) || changedRoles.includes(role));
    retained.current = hasPending ? { edit, sizeInputs, role } : null;
    useEffect(() => {
      if (edit && !dirty) setEdit(null);
    }, [edit, dirty]);
    useEffect(() => {
      if (edit) return;
      // A clean editor follows external settings; only invalid raw input needs retention.
      setSizeInputs(previous => {
        const invalid = Object.fromEntries(Object.entries(previous).filter(([item, raw]) => parseSizeInput(item, raw) === null));
        return Object.keys(invalid).length === Object.keys(previous).length ? previous : invalid;
      });
    }, [accepted, edit]);
    useEffect(() => {
      alive.current = true;
      const pending = enteringWrite || writes.get(form);
      setBusy(!!pending);
      if (pending) pending.then(ok => {
        if (!alive.current) return;
        if (ok) { setEdit(null); setSizeInputs({}); setNotice({ key: 'saved', kind: 'success' }); }
        else setNotice({ key: 'failed', kind: 'error' });
        setBusy(false);
      });
      return () => {
        alive.current = false;
        if (retained.current) drafts.set(form, retained.current); else drafts.delete(form);
      };
    }, [form, enteringWrite]);
    useEffect(() => {
      if (hasPending) drafts.set(form, { edit, sizeInputs, role }); else drafts.delete(form);
    }, [form, edit, sizeInputs, role, hasPending]);
    useEffect(() => {
      if (!hasPending && !(modal === 'advanced' && familyText !== selected.family)) return;
      const guard = event => { event.preventDefault(); event.returnValue = ''; };
      window.addEventListener('beforeunload', guard);
      return () => window.removeEventListener('beforeunload', guard);
    }, [hasPending, modal, familyText, selected.family]);
    useEffect(() => {
      if (notice?.kind !== 'success') return;
      const timer = setTimeout(() => setNotice(current => current === notice ? null : current), SAVED_NOTICE_MS);
      return () => clearTimeout(timer);
    }, [notice]);
    useLayoutEffect(() => {
      const trigger = triggerRef.current;
      if (!pickerOpen || !trigger) return;
      const view = scrollRoot.current?.getBoundingClientRect();
      const rect = trigger.getBoundingClientRect();
      const below = Math.min(view ? view.bottom : Infinity, window.innerHeight) - rect.bottom - 20;
      const above = rect.top - Math.max(view ? view.top : 0, 0) - 16;
      const up = below < 300 && above > below;
      setPickerFit({ up, max: Math.floor(Math.min(520, Math.max(200, up ? above : below))) });
    }, [pickerOpen]);
    useEffect(() => {
      if (!pickerOpen) return;
      searchRef.current?.focus();
      const doc = pickerRef.current?.ownerDocument;
      const outside = event => {
        if (!pickerRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) setPickerOpen(false);
      };
      doc?.addEventListener('pointerdown', outside);
      return () => doc?.removeEventListener('pointerdown', outside);
    }, [pickerOpen]);
    // Comparison panes scroll together by relative position; their content heights differ with font size.
    useEffect(() => {
      const grid = gridRef.current;
      if (!grid) return;
      const expected = new WeakMap();
      const sync = event => {
        const pane = event.target;
        if (!pane?.classList?.contains('dfm-pv-scroll')) return;
        const target = expected.get(pane);
        expected.delete(pane);
        if (target !== undefined && Math.abs(pane.scrollTop - target) < 2) return;
        const range = pane.scrollHeight - pane.clientHeight;
        const ratio = range > 0 ? pane.scrollTop / range : 0;
        for (const other of grid.querySelectorAll('.dfm-pv-scroll')) {
          if (other === pane) continue;
          const top = Math.round(ratio * (other.scrollHeight - other.clientHeight));
          if (Math.abs(other.scrollTop - top) < 1) continue;
          expected.set(other, top);
          other.scrollTop = top;
        }
      };
      grid.addEventListener('scroll', sync, true);
      return () => grid.removeEventListener('scroll', sync, true);
    }, [ready]);
    useEffect(() => {
      for (const pane of gridRef.current?.querySelectorAll('.dfm-pv-scroll') || []) pane.scrollTop = 0;
    }, [role]);
    // Sticky offsets honor the Host page's bottom padding; while stuck, the footer covers that strip.
    useEffect(() => {
      const end = endRef.current;
      if (!end || typeof IntersectionObserver !== 'function') return;
      const observer = new IntersectionObserver(([entry]) => setFooterStuck(!entry.isIntersecting
        && !!entry.rootBounds && entry.boundingClientRect.top >= entry.rootBounds.bottom), { root: scrollRoot.current });
      observer.observe(end);
      return () => observer.disconnect();
    }, [ready]);
    const selectRole = item => { setRole(item); setPickerOpen(false); };
    const closePicker = () => { setPickerOpen(false); triggerRef.current?.focus(); };
    const editRole = patch => {
      if (!canEdit) return;
      setNotice(null);
      setEdit(previous => stageFontEdit(previous, accepted, snapshot.revision, role, patch));
    };
    const clearSizeInput = () => setSizeInputs(previous => { const next = { ...previous }; delete next[role]; return next; });
    const setSize = value => {
      if (!canEdit) return;
      clearSizeInput();
      editRole({ size: value });
    };
    const stepSize = delta => setSize(Math.min(spec.max, Math.max(spec.min, selected.size + delta)));
    const typeSize = raw => {
      setSizeInputs(previous => ({ ...previous, [role]: raw }));
      const value = parseSizeInput(role, raw);
      if (value !== null) editRole({ size: value });
    };
    const openAdvanced = () => {
      setPickerOpen(false); setFamilyText(selected.family); setFamilyError(false);
      familyStart.current = { edit, accepted, revision: snapshot.revision, role };
      setModal('advanced');
    };
    const finishAdvanced = () => {
      if (!canEdit) return;
      if (!validFamilyInput(familyText)) { setFamilyError(true); return; }
      const start = familyStart.current;
      setEdit(stageFontEdit(start.edit, start.accepted, start.revision, start.role, { family: familyText }));
      setNotice(null); setModal(null);
    };
    const restore = () => {
      if (!canEdit) return;
      setNotice(null); setPickerOpen(false);
      setEdit(previous => stageFontReset(previous, accepted, readTypography(snapshot.base || {}), snapshot.revision, role));
      clearSizeInput();
    };
    const discard = () => {
      if (busyRef.current || writes.has(form)) return;
      setEdit(null); setSizeInputs({}); setNotice(null); setModal(null); drafts.delete(form);
    };
    const apply = async () => {
      if (busyRef.current || writes.has(form) || !dirty || invalidSizes.length || conflict || !ready || !snapshot.writable || snapshot.revision === undefined) return;
      busyRef.current = true; setBusy(true); setNotice(null); setPickerOpen(false);
      const task = (async () => {
        try {
          const ops = draftOperations(accepted, edit);
          const ok = await form.mutate(ops, edit.revision);
          if (ok) drafts.delete(form);
          if (!alive.current) return ok;
          if (ok) { setEdit(null); setSizeInputs({}); setNotice({ key: 'saved', kind: 'success' }); }
          else setNotice({ key: 'failed', kind: 'error' });
          return ok;
        } catch (error) {
          if (alive.current) setNotice({ key: 'transportError', detail: error instanceof Error ? error.message : String(error), kind: 'error' });
          return false;
        } finally {
          busyRef.current = false;
          if (alive.current) setBusy(false);
        }
      })();
      writes.set(form, task);
      await task;
      writes.delete(form);
    };
    const readLocal = async () => {
      if (localBusyRef.current) return;
      if (typeof window.queryLocalFonts !== 'function' || !window.isSecureContext) { setLocalNotice({ key: 'localUnsupported' }); return; }
      localBusyRef.current = true; setLocalBusy(true); setLocalNotice(null);
      try {
        const fonts = await window.queryLocalFonts();
        const names = [...new Set(fonts.map(font => font.family).filter(family => typeof family === 'string' && family.trim()))].sort((a, b) => a.localeCompare(b));
        if (!alive.current) return;
        setLocalFamilies(names); setLocalRead(true); setFilter('local'); setLocalLimit(LOCAL_BATCH);
        setLocalNotice({ key: names.length ? 'localLoaded' : 'localEmpty', count: names.length });
      } catch (error) {
        if (alive.current) setLocalNotice({ key: error?.name === 'NotAllowedError' || error?.name === 'SecurityError' ? 'localDenied' : 'localFailed', detail: error?.name === 'NotAllowedError' || error?.name === 'SecurityError' ? '' : String(error?.message || error) });
      } finally {
        localBusyRef.current = false;
        if (alive.current) setLocalBusy(false);
      }
    };
    const roleKeys = event => {
      const index = ROLES.indexOf(role);
      const next = { ArrowRight: (index + 1) % ROLES.length, ArrowLeft: (index + ROLES.length - 1) % ROLES.length, Home: 0, End: ROLES.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      selectRole(ROLES[next]);
      event.currentTarget.querySelectorAll('[role="tab"]')[next]?.focus();
    };
    const listKeys = event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      if (moveOptionFocus(event.currentTarget, event.key, event.currentTarget.ownerDocument.activeElement)) event.preventDefault();
    };

    const button = (content, onClick, props = {}) => h('button', { type: 'button', className: 'dfm-button', onClick, ...props }, content);
    const tag = (text, tone = 'neutral', props = {}) => h('span', { className: 'dfm-tag', 'data-tone': tone, ...props }, text);
    const segment = (groupLabel, options, className = 'dfm-segment') => h('div', { className, role: 'group', 'aria-label': groupLabel },
      ...options.map(([key, text, pressed, onClick, title]) => h('button', { type: 'button', key, 'aria-pressed': pressed, onClick, title }, text)));
    const noticeBox = (kind, text, action = null, live = kind === 'error' ? 'alert' : 'status') => h('div', { className: 'dfm-notice dfm-' + kind, role: live },
      h('span', { className: 'dfm-notice-text' }, icon(kind === 'success' ? 'check' : 'alert'), h('span', null, text)), action);
    const sizeDiff = item => accepted[item].size === values[item].size ? values[item].size + ' px'
      : h(Fragment, null, accepted[item].size, ' → ', h('b', { className: 'dfm-new' }, values[item].size + ' px'));
    const optionMeta = item => {
      if (item.category === 'default') return t('builtinMeta');
      const status = t(fontStatus(item.family, localFamilies, localRead));
      return filter === 'local' ? t(item.category) + ' · ' + status : status;
    };
    const fontOption = item => {
      const active = selectedFamily === normalizeFontFamily(item.family);
      return h('button', {
        type: 'button', key: item.family, className: 'dfm-font-card', disabled: !canEdit, 'aria-pressed': active,
        onClick: () => editRole({ family: item.family }),
      }, h('span', { className: 'dfm-font-sample', style: { fontFamily: previewFamily(role, item.family) }, 'aria-hidden': true }, item.category === 'mono' ? '0O 1l' : 'Aa 字'),
      h('span', { className: 'dfm-font-card-copy' }, h('span', { className: 'dfm-font-card-head' }, label(item.family)), h('span', { className: 'dfm-font-meta' }, optionMeta(item))),
      active ? h('span', { className: 'dfm-font-indicator' }, icon('check')) : null);
    };
    const previewColumn = (typography, heading, isReference = false) => h('section', {
      className: 'dfm-specimen', key: isReference ? 'reference' : 'draft', 'aria-label': heading,
      'data-reference': isReference || undefined, 'data-pending': (!isReference && dirty) || undefined,
    }, h('div', { className: 'dfm-specimen-heading' },
      h('div', { className: 'dfm-specimen-copy' },
        h('div', { className: 'dfm-specimen-label' }, h('strong', null, heading), !isReference && dirty ? tag(t('pendingTag'), 'info') : null),
        h('div', { className: 'dfm-family-title', title: label(typography[role].family) }, label(typography[role].family))),
      h('div', { className: 'dfm-specimen-size' }, typography[role].size, h('small', null, 'px'))),
    h(DshScene, { scene: role, typography, sample: samples[role], enlarge, t }));
    const diffChips = changedRoles.map(item => {
      const before = accepted[item], after = values[item];
      return h('div', { key: item, className: 'dfm-diff-chip' }, h('strong', null, t(item)),
        normalizeFontFamily(before.family) !== normalizeFontFamily(after.family)
          ? h('span', null, label(before.family), ' → ', h('b', { className: 'dfm-new' }, label(after.family))) : null,
        before.size !== after.size ? h('span', null, before.size, ' → ', h('b', { className: 'dfm-new' }, after.size + ' px')) : null,
        resets.includes(item) ? h('span', null, t(edit?.resetEdits?.[item] ? 'restorePartialTag' : 'restoreTag')) : null);
    });

    if (!ready) return h('section', { ref: pageRef, className: 'dfm-page', 'aria-label': t('settingsTitle'), 'aria-busy': snapshot.status === 'loading' || undefined },
      h('style', null, assets.styles),
      h('p', { className: 'dfm-placeholder', role: 'status' }, snapshot.status === 'loading' ? h('span', { className: 'dfm-spinner', 'aria-hidden': true }) : null,
        t(snapshot.status === 'loading' ? 'loading' : 'unavailable')));

    const roleTabs = h('div', { className: 'dfm-roles', role: 'tablist', 'aria-label': t('selectRole'), onKeyDown: roleKeys },
      ...ROLES.map(item => h('button', {
        type: 'button', key: item, id: ids + '-tab-' + item, role: 'tab', className: 'dfm-role',
        'aria-selected': role === item, 'aria-controls': ids + '-panel', tabIndex: role === item ? 0 : -1,
        onClick: () => selectRole(item),
      }, h('span', { className: 'dfm-role-icon', 'aria-hidden': true }, item === 'text' ? 'Tt' : icon(item)),
      h('span', { className: 'dfm-role-info' },
        h('span', { className: 'dfm-role-top' }, h('span', { className: 'dfm-role-name' }, t(item)),
          changedRoles.includes(item) ? h('span', { className: 'dfm-changed-dot', role: 'img', 'aria-label': t('pendingTag') }) : null),
        h('span', { className: 'dfm-role-foot', 'data-invalid': invalidSizes.includes(item) || undefined },
          invalidSizes.includes(item) ? t('invalidSizeTag') : h(Fragment, null,
            h('span', { className: 'dfm-role-family' }, label(values[item].family)),
            h('span', { className: 'dfm-role-size' }, sizeDiff(item))))))));
    const empty = filter === 'local' && !localRead
      ? h('div', { className: 'dfm-empty' }, h('strong', null, t('localNotRead')), h('p', null, t('localReadHint')))
      : h('div', { className: 'dfm-empty' }, h('strong', null, t('empty')), h('p', null, t('emptyHint')));
    const picker = h('section', {
      ref: pickerRef, id: ids + '-picker', className: 'dfm-font-popover', role: 'dialog', 'aria-label': t('chooseFont'),
      'data-placement': pickerFit?.up ? 'top' : undefined, style: pickerFit ? { maxHeight: pickerFit.max + 'px' } : undefined,
      onKeyDown: event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePicker(); } },
    }, h('label', { className: 'dfm-picker-search' }, icon('search'),
      h('input', {
        ref: searchRef, type: 'search', placeholder: t('search'), 'aria-label': t('search'), value: search,
        onChange: event => { setSearch(event.target.value); setLocalLimit(LOCAL_BATCH); },
        onKeyDown: event => { if (event.key === 'ArrowDown' && listRef.current && moveOptionFocus(listRef.current, 'Home')) event.preventDefault(); },
      })),
    h('div', { className: 'dfm-picker-header' },
      h('div', { className: 'dfm-segment dfm-filters', role: 'group', 'aria-label': t('library') }, ...['recommended', 'local'].map(item => h('button', {
        type: 'button', key: item, 'aria-pressed': filter === item, onClick: () => { setFilter(item); setLocalLimit(LOCAL_BATCH); },
      }, t(item), item === 'local' && localRead ? h('span', { className: 'dfm-count' }, localFamilies.length) : null))),
      h('button', { type: 'button', className: 'dfm-link', onClick: readLocal, disabled: localBusy }, icon('monitor'), t(localBusy ? 'authorizing' : localRead ? 'reauthorize' : 'authorize'))),
    h('div', { ref: listRef, className: 'dfm-font-list', onKeyDown: listKeys },
      matches.length ? groups.map(group => h('div', { key: group.category, className: 'dfm-font-group', role: 'group', 'aria-label': t(group.category === 'default' ? 'groupDefault' : group.category) },
        filter === 'local' ? null : h('div', { className: 'dfm-group-label', 'aria-hidden': true }, t(group.category === 'default' ? 'groupDefault' : group.category)),
        ...group.items.map(fontOption))) : empty,
      hiddenCount ? h('button', { type: 'button', className: 'dfm-show-more', onClick: () => setLocalLimit(limit => limit + LOCAL_BATCH) }, fmt('showMore', { count: hiddenCount })) : null),
    h('div', { className: 'dfm-picker-foot' },
      localNotice ? h('p', { className: 'dfm-local-notice', role: 'status' }, fmt(localNotice.key, { count: localNotice.count ?? 0 }) + (localNotice.detail || '')) : null,
      h('p', null, t('pickerHint')),
      h('details', { className: 'dfm-local' }, h('summary', null, t('readMore')), h('p', null, t('availableHint')), h('p', null, t('privacy')))));
    const sizeError = invalidSizes.includes(role);
    const editor = h('section', { className: 'dfm-editor' },
      h('div', { className: 'dfm-editor-head' }, roleTabs,
        button(h(Fragment, null, icon('undo'), t('restore')), restore, { className: 'dfm-button dfm-ghost dfm-small dfm-restore-trigger', disabled: !canRestore, title: t('restoreHint') })),
      h('div', { className: 'dfm-controls', role: 'tabpanel', id: ids + '-panel', 'aria-labelledby': ids + '-tab-' + role },
        h('div', { className: 'dfm-family-field', onBlur: event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setPickerOpen(false); } },
          h('div', { className: 'dfm-field-label' }, h('span', { id: ids + '-font-label' }, t('fontLabel')),
            tag(t(selectedStatus), STATUS_TONE[selectedStatus], { title: t('availableHint') }),
            h('button', { type: 'button', className: 'dfm-link dfm-advanced-trigger', onClick: openAdvanced, disabled: !canEdit }, icon('sliders'), t('customStack'))),
          h('button', {
            type: 'button', ref: triggerRef, className: 'dfm-font-trigger', disabled: !canEdit, onClick: () => setPickerOpen(open => !open),
            'aria-haspopup': 'dialog', 'aria-expanded': pickerOpen, 'aria-controls': ids + '-picker', 'aria-label': t('chooseFont') + ': ' + label(selected.family),
          }, h('span', { className: 'dfm-font-aa', style: { fontFamily: previewFamily(role, selected.family) }, 'aria-hidden': true }, role === 'text' ? 'Aa' : '0O'),
          h('strong', { className: 'dfm-selected-family' }, label(selected.family)), icon('down')),
          pickerOpen ? picker : null),
        h('div', { className: 'dfm-size-field' },
          h('div', { className: 'dfm-field-label' }, h('label', { htmlFor: ids + '-size' }, t('size')), tag(fmt('sizeRange', { min: spec.min, max: spec.max }))),
          h('div', { className: 'dfm-size-row' },
            h('input', { type: 'range', min: spec.min, max: spec.max, step: 1, value: selected.size, disabled: !canEdit, 'aria-label': t('size'), 'aria-valuetext': selected.size + ' px', onChange: event => setSize(Number(event.target.value)) }),
            h('div', { className: 'dfm-number-stepper' },
              button('−', () => stepSize(-1), { disabled: !canEdit || selected.size <= spec.min, 'aria-label': t('decreaseSize') }),
              h('input', {
                id: ids + '-size', type: 'text', inputMode: 'numeric', maxLength: 3, value: sizeInputs[role] ?? String(selected.size), disabled: !canEdit,
                'aria-invalid': sizeError || undefined, 'aria-describedby': sizeError ? ids + '-size-error' : undefined,
                onChange: event => typeSize(event.target.value),
                onBlur: () => { if (parseSizeInput(role, sizeInputs[role] ?? String(selected.size)) !== null) clearSizeInput(); },
                onKeyDown: event => {
                  if (event.key === 'Escape') { clearSizeInput(); event.stopPropagation(); }
                  else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); stepSize(event.key === 'ArrowUp' ? 1 : -1); }
                },
              }), h('span', null, 'px'),
              button('+', () => stepSize(1), { disabled: !canEdit || selected.size >= spec.max, 'aria-label': t('increaseSize') }))))),
      sizeError ? h('p', { id: ids + '-size-error', className: 'dfm-editor-note dfm-input-error', role: 'status' }, fmt('invalidSize', { min: spec.min, max: spec.max })) : null,
      resets.includes(role) ? h('p', { className: 'dfm-editor-note dfm-reset-note' }, icon('undo'), t(edit?.resetEdits?.[role] ? 'restorePartialTag' : 'restoreTag')) : null);
    const preview = h('section', { className: 'dfm-preview-area', 'aria-labelledby': ids + '-preview' },
      h('div', { className: 'dfm-preview-toolbar' },
        h('div', { className: 'dfm-section-heading' }, h('h5', { id: ids + '-preview' }, t('previewTitle')), tag(t(SCENE_KEY[role]), 'neutral', { className: 'dfm-tag dfm-scene-label' })),
        h('div', { className: 'dfm-preview-actions' },
          segment(t('previewMode'), [['compare', t('compare'), compare, () => setCompare(true)], ['draft', t('preview'), !compare, () => setCompare(false)]]),
          segment(t('previewZoom'), [['actual', '100%', !enlarge, () => setEnlarge(false), t('actual')], ['enlarge', '150%', enlarge, () => setEnlarge(true), t('zoomHint')]], 'dfm-segment dfm-zoom'),
          button(h(Fragment, null, icon('edit'), t('editSample')), () => { setSampleText(samples[role]); setModal('sample'); }, { className: 'dfm-button dfm-ghost dfm-small dfm-sample-trigger' }))),
      h('div', { ref: gridRef, className: 'dfm-preview-grid', 'data-compare': compare || undefined }, compare ? previewColumn(accepted, t('reference'), true) : null, previewColumn(values, t('draft'))),
      h('p', { className: 'dfm-preview-note' }, role === 'terminal' ? t('terminalShortNote') : t('previewReadonly')));
    const footer = h('footer', { className: 'dfm-footer', 'data-dirty': dirty || undefined, 'data-stuck': footerStuck || undefined },
      conflict ? noticeBox('warning', t('conflict'), button(t('reload'), () => setModal('discard'), { className: 'dfm-button dfm-small' }), 'alert') : null,
      !snapshot.writable ? noticeBox('warning', t('readonly')) : null,
      invalidSizes.length ? noticeBox('warning', fmt('invalidRoles', { roles: invalidSizes.map(item => t(item)).join(' / ') })) : null,
      notice ? noticeBox(notice.kind, t(notice.key) + (notice.detail || '')) : null,
      h('div', { className: 'dfm-footer-row' },
        h('div', { className: 'dfm-summary' },
          h('div', { className: 'dfm-pending-title', role: 'status' }, dirty ? h('span', { className: 'dfm-status-dot', 'aria-hidden': true }) : icon('check'),
            h('strong', null, dirty ? fmt('pending', { count: changedRoles.length }) : t('unchanged'))),
          dirty ? h('div', { className: 'dfm-diffs' }, ...diffChips) : null,
          dirty ? h('p', { className: 'dfm-scope' }, t('scope')) : null),
        h('div', { className: 'dfm-actions' },
          button(t('discard'), () => setModal('discard'), { disabled: !hasPending || busy }),
          button(h(Fragment, null, busy ? h('span', { className: 'dfm-spinner', 'aria-hidden': true }) : null, t(busy ? 'saving' : 'apply')), apply, {
            className: 'dfm-button dfm-primary', 'aria-busy': busy || undefined, title: t('scope'),
            disabled: !dirty || busy || conflict || invalidSizes.length > 0 || !snapshot.writable,
          }))));
    return h('section', { ref: pageRef, className: 'dfm-page', 'data-font-manager': assets.version, 'aria-label': t('settingsTitle') },
      h('style', null, assets.styles),
      h('header', { className: 'dfm-header' }, h('h4', null, t('settingsTitle')), h('p', { className: 'dfm-intro' }, t('subtitle'))),
      editor, preview, footer, h('div', { ref: endRef, className: 'dfm-end', 'aria-hidden': true }),
      h(Dialog, { closeLabel: t('closeDialog'), open: modal === 'advanced', title: t('advancedTitle'), onClose: () => setModal(null) },
        h('label', { className: 'dfm-field' }, h('span', { className: 'dfm-field-name' }, fmt('familyFor', { role: t(role) })),
          h('input', { type: 'text', className: 'dfm-input', value: familyText, maxLength: FAMILY_MAX_LENGTH, disabled: !canEdit, onChange: event => { setFamilyText(event.target.value); setFamilyError(false); }, 'aria-invalid': familyError || undefined, placeholder: t('familyPlaceholder') })),
        h('p', { className: 'dfm-help' }, t('familyHint')), familyError ? noticeBox('error', t('invalidFamily')) : null,
        h('div', { className: 'dfm-dialog-actions' }, button(t('cancel'), () => setModal(null)), button(t('done'), finishAdvanced, { className: 'dfm-button dfm-primary', disabled: !canEdit }))),
      h(Dialog, { closeLabel: t('closeDialog'), open: modal === 'sample', title: t('sampleAndGlyphs'), onClose: () => setModal(null) },
        h('label', { className: 'dfm-field' }, h('span', { className: 'dfm-field-name' }, fmt('sampleFor', { scene: t(SCENE_KEY[role]) })),
          h('textarea', { className: 'dfm-input', rows: 4, value: sampleText, maxLength: 4000, placeholder: t('samplePlaceholder'), onChange: event => setSampleText(event.target.value) })),
        h('p', { className: 'dfm-help' }, t('sampleRoleHint')),
        h('div', { className: 'dfm-field' }, h('span', { className: 'dfm-field-name' }, t('glyphs')),
          h('div', { className: 'dfm-glyphs', style: { fontFamily: previewFamily(role, selected.family), fontSize: selected.size + 'px' } }, t('glyphSample'))),
        h('details', { className: 'dfm-specimen-info' }, h('summary', null, t('specimenDetails')),
          h('div', { className: 'dfm-stack' }, h('span', null, t('normalized')), h('code', null, normalizeFontFamily(selected.family) || t('builtin'))),
          h('p', { className: 'dfm-help' }, role === 'terminal' ? t('pvTerminalNote') : t('sceneNote'))),
        h('div', { className: 'dfm-dialog-actions' }, button(t('resetSample'), () => setSampleText(''), { className: 'dfm-link dfm-dialog-aside' }),
          button(t('done'), () => { setSamples(previous => ({ ...previous, [role]: sampleText })); setModal(null); }, { className: 'dfm-button dfm-primary' }))),
      h(Dialog, { closeLabel: t('closeDialog'), open: modal === 'discard', title: t('discardTitle'), busy, onClose: () => setModal(null) },
        h('p', { className: 'dfm-help' }, t('discardConfirm')),
        h('div', { className: 'dfm-dialog-actions' }, button(t('keepEditing'), () => setModal(null)), button(t('confirmDiscard'), discard, { disabled: busy, className: 'dfm-button dfm-primary' }))));
  }
  return {
    inject: ['slots', 'locale', 'configForms'],
    apply(ctx) {
      ctx.effect(() => ctx.locale.register(LOCALE_NS, 'zh', assets.dictionaries.zh));
      ctx.effect(() => ctx.locale.register(LOCALE_NS, 'en', assets.dictionaries.en));
      const t = ctx.locale.bind(LOCALE_NS);
      ctx.effect(() => ctx.configForms.whileServed(['ui-theme'], () => {
        const form = ctx.configForms.get('ui-theme');
        return ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config', key: PACKAGE_ID,
        }, ({ view }) => view === 'page' ? h(FontSettings, { form, locale: ctx.locale, t }) : null));
      }));
    },
  };
}

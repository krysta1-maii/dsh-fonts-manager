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
  const DshScene = createSceneRenderer(React);
  const { useState, useMemo, useCallback, useSyncExternalStore, useRef, useEffect, useId } = React;
  // In-memory, scoped to this Client plugin and native form; no browser/profile persistence.
  const drafts = new WeakMap();
  const writes = new WeakMap();
  const paths = {
    check: 'm5 12 4 4 10-10', down: 'm7 10 5 5 5-5', arrow: 'M5 12h14m-5-5 5 5-5 5',
    code: 'm8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 20', terminal: 'm4 6 6 6-6 6m10 0h6',
    sliders: 'M4 7h6m4 0h6M4 17h10m4 0h2M10 5h4v4h-4zM14 15h4v4h-4z',
    close: 'm6 6 12 12M6 18 18 6', monitor: 'M3 4h18v13H3zM12 17v4m-4 0h8',
    search: 'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0Zm-1 5 5 5',
  };
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
    const pickerRef = useRef(null);
    const triggerRef = useRef(null);
    const searchRef = useRef(null);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState('recommended');
    const [page, setPage] = useState(1);
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
    const values = edit?.values || accepted;
    const resets = edit?.resetRoles || [];
    const changes = pendingChanges(accepted, values, resets);
    const changedRoles = [...new Set([...Object.keys(changes), ...resets])];
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
    const filtered = useMemo(() => catalog.filter(item => (filter === 'local' ? item.local : item.recommended)
      && (item.family || t('builtin')).toLowerCase().includes(search.toLowerCase().trim())), [catalog, search, filter, t, localeSnapshot.revision]);
    const pages = Math.max(1, Math.ceil(filtered.length / 8));
    const currentPage = Math.min(page, pages);
    const visible = filtered.slice((currentPage - 1) * 8, currentPage * 8);
    const selectedFamily = normalizeFontFamily(selected.family);
    const selectedStatus = fontStatus(selected.family, localFamilies, localRead);
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
      if (!pickerOpen) return;
      searchRef.current?.focus();
      const doc = pickerRef.current?.ownerDocument;
      const outside = event => {
        if (!pickerRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) setPickerOpen(false);
      };
      doc?.addEventListener('pointerdown', outside);
      return () => doc?.removeEventListener('pointerdown', outside);
    }, [pickerOpen]);
    const closePicker = () => { setPickerOpen(false); triggerRef.current?.focus(); };
    const editRole = patch => {
      if (!canEdit) return;
      setNotice(null);
      setEdit(previous => stageFontEdit(previous, accepted, snapshot.revision, role, patch));
    };
    const setSize = value => {
      if (!canEdit) return;
      setSizeInputs(previous => { const next = { ...previous }; delete next[role]; return next; });
      editRole({ size: value });
    };
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
      setNotice(null);
      setEdit(previous => stageFontReset(previous, accepted, readTypography(snapshot.base || {}), snapshot.revision, role));
      setSizeInputs(previous => { const next = { ...previous }; delete next[role]; return next; });
      setModal(null);
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
        setLocalFamilies(names); setLocalRead(true); setFilter('local'); setPage(1);
        setLocalNotice({ key: names.length ? 'localLoaded' : 'localEmpty', count: names.length });
      } catch (error) {
        if (alive.current) setLocalNotice({ key: error?.name === 'NotAllowedError' || error?.name === 'SecurityError' ? 'localDenied' : 'localFailed', detail: error?.name === 'NotAllowedError' || error?.name === 'SecurityError' ? '' : String(error?.message || error) });
      } finally {
        localBusyRef.current = false;
        if (alive.current) setLocalBusy(false);
      }
    };
    const button = (text, onClick, props = {}) => h('button', { type: 'button', className: 'dfm-button', onClick, ...props }, text);
    const noticeNode = (key, kind = 'warning') => h('p', { className: 'dfm-notice dfm-' + kind, role: kind === 'error' ? 'alert' : 'status' }, t(key));
    const previewColumn = (typography, heading, isReference = false) => h('section', { className: 'dfm-specimen', key: isReference ? 'reference' : 'draft', 'data-reference': isReference || undefined },
      h('div', { className: 'dfm-specimen-heading' }, h('div', null,
        h('div', { className: 'dfm-specimen-label' }, h('strong', null, heading), !isReference && dirty ? h('span', { className: 'dfm-preview-badge' }, t('pendingTag')) : null),
        h('div', { className: 'dfm-family-title' }, label(typography[role].family))),
      h('div', { className: 'dfm-specimen-size' }, typography[role].size, h('small', null, 'px'))),
      h(DshScene, { scene: role, typography, sample: samples[role], enlarge, t }));
    const sizeDiff = item => accepted[item].size === values[item].size ? values[item].size + ' px'
      : h(React.Fragment, null, accepted[item].size, ' → ', h('b', { className: 'dfm-new' }, values[item].size + ' px'));
    const diffChips = changedRoles.map(item => {
      const before = accepted[item], after = values[item];
      return h('div', { key: item, className: 'dfm-diff-chip' }, h('strong', null, t(item)),
        normalizeFontFamily(before.family) !== normalizeFontFamily(after.family)
          ? h('span', null, label(before.family), ' → ', h('b', { className: 'dfm-new' }, label(after.family))) : null,
        before.size !== after.size ? h('span', null, before.size, ' → ', h('b', { className: 'dfm-new' }, after.size + ' px')) : null,
        resets.includes(item) ? h('span', null, t(edit?.resetEdits?.[item] ? 'restorePartialTag' : 'restoreTag')) : null);
    });
    if (!ready) return h('section', { className: 'dfm-page', 'aria-label': t('settingsTitle') }, h('style', null, assets.styles), h('p', { role: 'status' }, t(snapshot.status === 'loading' ? 'loading' : 'unavailable')));
    return h('section', { className: 'dfm-page', 'data-font-manager': '1.2.0', 'aria-label': t('settingsTitle') },
      h('style', null, assets.styles),
      h('header', { className: 'dfm-header' }, h('div', { className: 'dfm-brand' }, h('span', { className: 'dfm-brand-icon', 'aria-hidden': true }, 'Aa'),
        h('div', null, h('h2', null, t('settingsTitle')), h('p', { className: 'dfm-intro' }, t('subtitle')))),
      h('span', { className: 'dfm-context-tag' }, t('previewOnly'))),
      h('section', { className: 'dfm-roles', 'aria-label': t('selectRole') }, ...ROLES.map(item => h('button', {
        type: 'button', key: item, className: 'dfm-role', 'aria-pressed': role === item,
        onClick: () => { setRole(item); setPickerOpen(false); },
      }, h('span', { className: 'dfm-role-icon', 'aria-hidden': true }, item === 'text' ? 'Tt' : icon(item)),
      h('span', { className: 'dfm-role-info' }, h('span', { className: 'dfm-role-top' }, t(item),
        changedRoles.includes(item) ? h('span', { className: 'dfm-changed-dot', title: t('pendingTag') }) : null),
      h('span', { className: 'dfm-role-foot' }, invalidSizes.includes(item) ? t('invalidSizeTag') : sizeDiff(item))),
      role === item ? h('span', { className: 'dfm-role-check' }, icon('check')) : null))),
      h('section', { className: 'dfm-editor', 'aria-label': t(role) },
        h('div', { className: 'dfm-controls' },
          h('div', { className: 'dfm-family-field', onBlur: event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setPickerOpen(false); } },
            h('div', { className: 'dfm-field-label' }, h('span', { id: ids + '-font-label' }, t('fontLabel')), h('span', { className: 'dfm-count', title: t('availableHint') }, t(selectedStatus))),
            button(h(React.Fragment, null, h('span', { className: 'dfm-font-aa', 'aria-hidden': true }, 'Aa'), h('strong', { className: 'dfm-selected-family' }, label(selected.family)), icon('down')),
              () => setPickerOpen(open => !open), { ref: triggerRef, className: 'dfm-font-trigger', disabled: !canEdit, 'aria-haspopup': 'dialog', 'aria-expanded': pickerOpen, 'aria-controls': ids + '-picker', 'aria-label': t('chooseFont') + ': ' + label(selected.family) }),
            pickerOpen ? h('section', { ref: pickerRef, id: ids + '-picker', className: 'dfm-font-popover', role: 'dialog', 'aria-label': t('chooseFont'),
              onKeyDown: event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePicker(); } },
            }, h('div', { className: 'dfm-picker-header' }, h('strong', null, t('chooseFont')), button(h(React.Fragment, null, icon('monitor'), t(localBusy ? 'authorizing' : 'authorize')), readLocal, { className: 'dfm-text-button', disabled: localBusy })),
            h('input', { ref: searchRef, type: 'search', className: 'dfm-input', placeholder: t('search'), 'aria-label': t('search'), value: search, onChange: event => { setSearch(event.target.value); setPage(1); } }),
            h('div', { className: 'dfm-filters', 'aria-label': t('library') }, ...['recommended', 'local'].map(item => button(t(item), () => { setFilter(item); setPage(1); }, { key: item, className: 'dfm-chip', 'aria-pressed': filter === item }))),
            h('div', { className: 'dfm-font-list' }, visible.length ? visible.map(item => h('button', {
              type: 'button', key: item.family, className: 'dfm-font-card', disabled: !canEdit, 'aria-pressed': selectedFamily === normalizeFontFamily(item.family),
              onClick: () => editRole({ family: item.family }),
            }, h('span', { className: 'dfm-font-sample', style: { fontFamily: previewFamily(role, item.family) }, 'aria-hidden': true }, item.category === 'mono' ? '0O 1l' : 'Aa 字'),
            h('span', { className: 'dfm-font-card-copy' }, h('span', { className: 'dfm-font-card-head' }, label(item.family)),
              h('span', { className: 'dfm-font-meta' }, t(item.category === 'default' ? 'defaultTag' : item.category), ' · ', t(fontStatus(item.family, localFamilies, localRead)))),
            selectedFamily === normalizeFontFamily(item.family) ? h('span', { className: 'dfm-font-indicator' }, icon('check')) : null))
              : h('div', { className: 'dfm-empty' }, h('strong', null, t(filter === 'local' && !localRead ? 'localNotRead' : 'empty')), h('p', null, t(filter === 'local' && !localRead ? 'localReadHint' : 'emptyHint')))),
            h('nav', { className: 'dfm-pagination', 'aria-label': t('library') }, button('‹', () => setPage(currentPage - 1), { disabled: currentPage <= 1, 'aria-label': t('previous') }), h('span', null, fmt('page', { page: currentPage, pages, count: filtered.length })), button('›', () => setPage(currentPage + 1), { disabled: currentPage >= pages, 'aria-label': t('next') })),
            localNotice ? h('p', { className: 'dfm-local-notice', role: 'status' }, fmt(localNotice.key, { count: localNotice.count ?? 0 }) + (localNotice.detail || '')) : null,
            h('p', { className: 'dfm-help' }, t('pickerHint')),
            h('details', { className: 'dfm-local' }, h('summary', null, t('readMore')), h('p', { className: 'dfm-help' }, t('availableHint')), h('p', { className: 'dfm-help' }, t('privacy')))) : null),
          h('div', { className: 'dfm-size-field' }, h('label', { className: 'dfm-field-label', htmlFor: ids + '-size' }, t('size'), h('span', { className: 'dfm-count' }, fmt('sizeRange', { min: spec.min, max: spec.max }))),
            h('div', { className: 'dfm-size-row' }, h('input', { type: 'range', min: spec.min, max: spec.max, step: 1, value: selected.size, disabled: !canEdit, 'aria-label': t('size'), 'aria-valuetext': selected.size + ' px', onChange: event => setSize(Number(event.target.value)) }),
              h('div', { className: 'dfm-number-stepper' }, button('−', () => setSize(Math.max(spec.min, selected.size - 1)), { disabled: !canEdit || selected.size <= spec.min, 'aria-label': t('decreaseSize') }),
                h('input', { id: ids + '-size', type: 'text', inputMode: 'numeric', maxLength: 3, value: sizeInputs[role] ?? String(selected.size), disabled: !canEdit,
                  'aria-invalid': invalidSizes.includes(role) || undefined, 'aria-describedby': invalidSizes.includes(role) ? ids + '-size-error' : undefined,
                  onChange: event => typeSize(event.target.value), onBlur: () => { const size = parseSizeInput(role, sizeInputs[role] ?? String(selected.size)); if (size !== null) setSizeInputs(previous => { const next = { ...previous }; delete next[role]; return next; }); },
                  onKeyDown: event => { if (event.key === 'Escape') { setSizeInputs(previous => { const next = { ...previous }; delete next[role]; return next; }); event.stopPropagation(); } },
                }), h('span', null, 'px'), button('+', () => setSize(Math.min(spec.max, selected.size + 1)), { disabled: !canEdit || selected.size >= spec.max, 'aria-label': t('increaseSize') })))),
          button(h(React.Fragment, null, icon('sliders'), t('advanced')), openAdvanced, { className: 'dfm-advanced-trigger', disabled: !canEdit })),
        invalidSizes.includes(role) ? h('p', { id: ids + '-size-error', className: 'dfm-input-error', role: 'status' }, fmt('invalidSize', { min: spec.min, max: spec.max })) : null,
        resets.includes(role) ? h('p', { className: 'dfm-help dfm-reset-note' }, t(edit?.resetEdits?.[role] ? 'restorePartialTag' : 'restoreTag')) : null),
      h('section', { className: 'dfm-preview-area', 'aria-label': t('previewTitle') },
        h('div', { className: 'dfm-preview-toolbar' }, h('div', { className: 'dfm-section-heading' }, h('h2', null, t('previewTitle')), h('span', { className: 'dfm-scene-label' }, t(role === 'text' ? 'sceneText' : role === 'code' ? 'sceneCode' : 'sceneTerminal'))),
          h('div', { className: 'dfm-preview-actions' }, h('div', { className: 'dfm-segment', 'aria-label': t('preview') }, button(t('compare'), () => setCompare(true), { 'aria-pressed': compare }), button(t('preview'), () => setCompare(false), { 'aria-pressed': !compare })),
            button(h(React.Fragment, null, icon('search'), enlarge ? '150% ' + t('previewScale') : '100% ' + t('actual')), () => setEnlarge(value => !value), { className: 'dfm-zoom-button', 'aria-pressed': enlarge, title: t('zoomHint') }))),
        h('div', { className: 'dfm-preview-grid', 'data-compare': compare || undefined }, compare ? previewColumn(accepted, t('reference'), true) : null, previewColumn(values, t('draft'))),
        h('div', { className: 'dfm-preview-notes' }, h('span', null, role === 'terminal' ? t('terminalShortNote') : t('previewReadonly')),
          button(h(React.Fragment, null, t('sampleAndGlyphs'), icon('arrow')), () => { setSampleText(samples[role]); setModal('sample'); }, { className: 'dfm-text-button' }))),
      h('footer', { className: 'dfm-footer' },
        conflict ? h('div', { className: 'dfm-notice dfm-warning', role: 'alert' }, t('conflict'), button(t('reload'), () => setModal('discard'))) : null,
        !snapshot.writable ? noticeNode('readonly') : null,
        invalidSizes.length ? h('p', { className: 'dfm-notice dfm-warning', role: 'status' }, fmt('invalidRoles', { roles: invalidSizes.map(item => t(item)).join(' / ') })) : null,
        notice ? h('p', { className: 'dfm-notice dfm-' + notice.kind, role: notice.kind === 'error' ? 'alert' : 'status' }, t(notice.key) + (notice.detail || '')) : null,
        h('div', { className: 'dfm-footer-row' }, h('div', { className: 'dfm-summary' }, h('strong', { className: 'dfm-pending-title' }, dirty ? fmt('pending', { count: changedRoles.length }) : t('unchanged')),
          h('div', { className: 'dfm-diffs', 'aria-live': 'polite' }, ...diffChips), h('p', { className: 'dfm-help' }, t('scope'))),
        h('div', { className: 'dfm-actions' }, button(t('discard'), () => setModal('discard'), { disabled: !hasPending || busy }),
          button(h(React.Fragment, null, t(busy ? 'saving' : 'apply'), icon('arrow')), apply, { disabled: !dirty || busy || conflict || invalidSizes.length > 0 || !snapshot.writable, className: 'dfm-button dfm-primary' })))),
      h(Dialog, { closeLabel: t('closeDialog'), open: modal === 'advanced', title: t('advancedTitle'), onClose: () => setModal(null) },
        h('label', { className: 'dfm-field' }, h('span', null, t('family')), h('input', { type: 'text', className: 'dfm-input', value: familyText, maxLength: FAMILY_MAX_LENGTH, disabled: !canEdit, onChange: event => { setFamilyText(event.target.value); setFamilyError(false); }, 'aria-invalid': familyError || undefined, placeholder: t('familyPlaceholder') })),
        h('p', { className: 'dfm-help' }, t('familyHint')), familyError ? noticeNode('invalidFamily', 'error') : null,
        h('p', { className: 'dfm-help' }, t('restoreHint')),
        h('div', { className: 'dfm-dialog-actions' }, button(t('restore'), restore, { className: 'dfm-text-button', disabled: !canEdit }), button(t('done'), finishAdvanced, { className: 'dfm-button dfm-primary', disabled: !canEdit }))),
      h(Dialog, { closeLabel: t('closeDialog'), open: modal === 'sample', title: t('sampleAndGlyphs'), onClose: () => setModal(null) },
        h('label', { className: 'dfm-field' }, h('span', null, t('sample')), h('textarea', { className: 'dfm-input', rows: 4, value: sampleText, maxLength: 4000, placeholder: t('samplePlaceholder'), onChange: event => setSampleText(event.target.value) })),
        h('p', { className: 'dfm-help' }, t('sampleRoleHint')),
        h('div', { className: 'dfm-glyphs', style: { fontFamily: previewFamily(role, selected.family), fontSize: selected.size + 'px' } }, t('glyphSample')),
        h('details', { className: 'dfm-specimen-info' }, h('summary', null, t('specimenDetails')), h('div', { className: 'dfm-stack' }, h('span', null, t('normalized')), h('code', null, normalizeFontFamily(selected.family) || t('builtin'))), h('p', { className: 'dfm-help' }, role === 'terminal' ? t('pvTerminalNote') : t('sceneNote'))),
        h('div', { className: 'dfm-dialog-actions' }, button(t('resetSample'), () => setSampleText(''), { className: 'dfm-text-button' }), button(t('done'), () => { setSamples(previous => ({ ...previous, [role]: sampleText })); setModal(null); }, { className: 'dfm-button dfm-primary' }))),
      h(Dialog, { closeLabel: t('closeDialog'), open: modal === 'discard', title: t('discardTitle'), busy, onClose: () => setModal(null) },
        h('p', { className: 'dfm-help' }, t('discardConfirm')), h('div', { className: 'dfm-dialog-actions' }, button(t('keepEditing'), () => setModal(null)), button(t('confirmDiscard'), discard, { disabled: busy, className: 'dfm-button dfm-primary' }))));
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

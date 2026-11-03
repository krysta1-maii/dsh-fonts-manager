/** Font-only settings operations for DSH 0.2.1 and 0.2.2. No runtime services or DOM. */
export const ROLES = Object.freeze(['text', 'code', 'terminal']);
export const ROLE_SPECS = Object.freeze({
  text: Object.freeze({ familyField: 'textFontFamily', sizeField: 'fontSize', min: 10, max: 22, defaultSize: 14 }),
  code: Object.freeze({ familyField: 'codeFontFamily', sizeField: 'codeFontSize', min: 10, max: 16, defaultSize: 11 }),
  terminal: Object.freeze({ familyField: 'terminalFontFamily', sizeField: 'terminalFontSize', min: 10, max: 20, defaultSize: 13 }),
});
export const FAMILY_MAX_LENGTH = 2048;

const GENERIC_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math',
  'fangsong', '-apple-system', 'blinkmacsystemfont',
]);

/** Match the native ui-theme normalizer; do not use the raw input as CSS. */
export function normalizeFontFamily(value) {
  if (typeof value !== 'string') throw new TypeError('Font family must be a string.');
  return value.split(',')
    .map((name) => name.replace(/["'\\<>\u0000-\u001f\u007f]/gu, '').replace(/\s+/gu, ' ').trim())
    .filter((name) => name !== '')
    .map((name) => GENERIC_FAMILIES.has(name.toLowerCase()) ? name : '"' + name + '"')
    .join(', ');
}

function isRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertRecord(value, label, allowed) {
  if (!isRecord(value)) throw new TypeError(label + ' must be a plain object.');
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) {
      throw new TypeError(label + ' contains an unsupported field.');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(label + ' must contain only enumerable data properties.');
    }
  }
  if (Object.keys(value).length === 0) throw new TypeError(label + ' must not be empty.');
}

/** Read editable raw family strings and validated integer sizes, with native defaults. */
export function readTypography(value) {
  const source = isRecord(value) ? value : {};
  return Object.fromEntries(ROLES.map((role) => {
    const spec = ROLE_SPECS[role];
    const family = Object.hasOwn(source, spec.familyField) ? source[spec.familyField] : undefined;
    const size = Object.hasOwn(source, spec.sizeField) ? source[spec.sizeField] : undefined;
    return [role, {
      family: typeof family === 'string' ? family : '',
      size: Number.isInteger(size) && size >= spec.min && size <= spec.max ? size : spec.defaultSize,
    }];
  }));
}

/** Validate a non-empty partial role map and produce native set operations only. */
export function typographyOperations(changes) {
  assertRecord(changes, 'changes', ROLES);
  const operations = [];
  for (const role of ROLES) {
    if (!Object.hasOwn(changes, role)) continue;
    const change = changes[role];
    const spec = ROLE_SPECS[role];
    assertRecord(change, role, ['family', 'size']);
    if (Object.hasOwn(change, 'family')) {
      if (typeof change.family !== 'string' || change.family.length > FAMILY_MAX_LENGTH) {
        throw new TypeError(role + '.family must be a string of at most ' + FAMILY_MAX_LENGTH + ' characters.');
      }
      const family = normalizeFontFamily(change.family);
      if (family.length > FAMILY_MAX_LENGTH) {
        throw new TypeError(role + '.family exceeds ' + FAMILY_MAX_LENGTH + ' characters after normalization.');
      }
      operations.push({ op: 'set', path: [spec.familyField], value: family });
    }
    if (Object.hasOwn(change, 'size')) {
      if (!Number.isInteger(change.size) || change.size < spec.min || change.size > spec.max) {
        throw new TypeError(role + '.size must be an integer from ' + spec.min + ' to ' + spec.max + '.');
      }
      operations.push({ op: 'set', path: [spec.sizeField], value: change.size });
    }
  }
  return operations;
}

/** Unset selected roles; an empty selection produces no operations for UI composition. */
export function resetOperations(roles) {
  if (!Array.isArray(roles) || roles.length > ROLES.length
    || Array.from(roles).some((role) => !ROLES.includes(role)) || new Set(roles).size !== roles.length) {
    throw new TypeError('roles must be a unique array of text, code, or terminal.');
  }
  return ROLES.filter((role) => roles.includes(role)).flatMap((role) => [
    { op: 'unset', path: [ROLE_SPECS[role].familyField] },
    { op: 'unset', path: [ROLE_SPECS[role].sizeField] },
  ]);
}

import { FAMILY_MAX_LENGTH, ROLES, ROLE_SPECS, readTypography, resetOperations, typographyOperations } from './shared.js';

export const inject = ['tools', 'settings', 'approval', 'sandboxPolicy'];
const NAMESPACE = 'ui-theme';
const MAX_REVISION = Number.MAX_SAFE_INTEGER;
const familySchema = { type: 'string', maxLength: FAMILY_MAX_LENGTH };
const sizeSchema = (role) => ({ type: 'integer', minimum: ROLE_SPECS[role].min, maximum: ROLE_SPECS[role].max });
const roleProperties = Object.fromEntries(ROLES.map((role) => [role, {
  type: 'object', additionalProperties: false, minProperties: 1,
  properties: { family: familySchema, size: sizeSchema(role) },
}]));
// Canonical output uses the narrower DSH JsonSchemaNode vocabulary.
// Numeric/string bounds are enforced by the shared validators and snapshot().
const outputFamilySchema = { type: 'string', description: 'Font family list, at most 2048 characters.' };
const typographySchema = {
  type: 'object', additionalProperties: false, required: [...ROLES],
  properties: Object.fromEntries(ROLES.map((role) => [role, {
    type: 'object', additionalProperties: false, required: ['family', 'size'],
    properties: { family: outputFamilySchema, size: { type: 'integer' } },
  }])),
};
const overrideSchema = {
  type: 'object', additionalProperties: false,
  properties: Object.fromEntries(ROLES.flatMap((role) => [
    [ROLE_SPECS[role].familyField, { oneOf: [outputFamilySchema, { type: 'null' }] }],
    [ROLE_SPECS[role].sizeField, { oneOf: [{ type: 'integer' }, { type: 'null' }] }],
  ])),
};

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

function parseArguments(args) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(args))) {
    throw failure('FONT_INVALID_ARGUMENT', 'Arguments must be a plain object.');
  }
  const allowed = ['action', 'changes', 'roles', 'expectedRevision'];
  for (const key of Reflect.ownKeys(args)) {
    const descriptor = Object.getOwnPropertyDescriptor(args, key);
    if (typeof key !== 'string' || !allowed.includes(key) || !descriptor.enumerable
      || !Object.hasOwn(descriptor, 'value')) {
      throw failure('FONT_INVALID_ARGUMENT', 'Arguments contain an unsupported field.');
    }
  }
  const { action, expectedRevision } = args;
  if (!['read', 'apply', 'reset'].includes(action)) {
    throw failure('FONT_INVALID_ARGUMENT', 'action must be read, apply, or reset.');
  }
  if (action === 'read') {
    if (Object.keys(args).length !== 1) throw failure('FONT_INVALID_ARGUMENT', 'read accepts only action.');
    return { action };
  }
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw failure('FONT_INVALID_ARGUMENT', 'apply and reset require the non-negative expectedRevision from read.');
  }
  if (Object.hasOwn(args, action === 'apply' ? 'roles' : 'changes')) {
    throw failure('FONT_INVALID_ARGUMENT', 'apply accepts changes; reset accepts roles.');
  }
  const ops = action === 'apply' ? typographyOperations(args.changes) : resetOperations(args.roles);
  if (ops.length === 0) throw failure('FONT_INVALID_ARGUMENT', 'reset requires at least one role.');
  return { action, expectedRevision, ops };
}

function descriptorOf(ctx) {
  const descriptors = ctx.settings.describe({ redactSecrets: true });
  const matches = descriptors.filter((descriptor) => descriptor.ns === NAMESPACE);
  if (matches.length !== 1) {
    throw failure('FONT_SETTINGS_UNAVAILABLE', 'Exactly one active ui-theme settings namespace is required.');
  }
  const descriptor = matches[0];
  if (!Number.isSafeInteger(descriptor.revision) || descriptor.revision < 0) {
    throw failure('FONT_SETTINGS_UNAVAILABLE', 'ui-theme returned an invalid revision.');
  }
  return descriptor;
}

function checkRevision(descriptor, expectedRevision) {
  if (descriptor.revision !== expectedRevision) {
    throw failure('FONT_REVISION_CONFLICT', 'ui-theme changed since read (expected revision '
      + expectedRevision + ', current ' + descriptor.revision + '). Read again before retrying.');
  }
}

function snapshot(descriptor, action) {
  const typography = readTypography(descriptor.value);
  const userOverrides = {};
  // Do not dump schemas, theme preference, secrets, or other namespaces to the model.
  for (const role of ROLES) {
    const spec = ROLE_SPECS[role];
    if (typography[role].family.length > FAMILY_MAX_LENGTH) {
      throw failure('FONT_STATE_UNSUPPORTED', 'An existing font family exceeds 2048 characters; edit it in native settings first.');
    }
    for (const field of [spec.familyField, spec.sizeField]) {
      if (descriptor.user == null || !Object.hasOwn(descriptor.user, field)) continue;
      const value = descriptor.user[field];
      const valid = value === null || (field === spec.familyField
        ? typeof value === 'string' && value.length <= FAMILY_MAX_LENGTH
        : Number.isInteger(value) && value >= spec.min && value <= spec.max);
      if (!valid) {
        throw failure('FONT_STATE_UNSUPPORTED', 'An existing font override is not a bounded literal; edit it in native settings first.');
      }
      userOverrides[field] = value;
    }
  }
  return { action, namespace: NAMESPACE, revision: descriptor.revision, typography, userOverrides };
}

async function approveWrite(ctx, request, exec, signal) {
  const policy = ctx.sandboxPolicy.resolve(exec.agent === undefined ? {} : { session: exec.agent.session });
  // Same scope as native plugin_manager: standing Full access or this call's grant.
  if (policy.mode === 'danger-full-access') return;
  if (!['read-only', 'workspace-write'].includes(policy.mode) || exec.agent === undefined) {
    throw failure('FONT_APPROVAL_UNAVAILABLE', 'Profile-wide font changes require danger-full-access or approval from an agent session.');
  }
  const justification = 'font_manager ' + JSON.stringify(request)
    + '. Only the six font fields may change; this affects every session in the current profile.';
  const outcome = await ctx.approval.request({
    agent: exec.agent, toolName: 'font_manager', callId: exec.callId, signal,
    reason: 'escalate sandbox to danger-full-access: ' + justification,
    displayReason: {
      en: 'Allow this font change with danger-full-access permissions: ' + justification,
      zh: '允许本次字体设置操作使用 danger-full-access 权限；它影响当前 profile 的所有会话：' + JSON.stringify(request),
    },
  });
  if (outcome !== 'allowed-once') {
    const status = ['rejected', 'cancelled', 'unavailable'].includes(outcome) ? outcome : 'unavailable';
    throw failure('FONT_APPROVAL_' + status.toUpperCase(), 'Font change approval was ' + status + '; no settings were changed.');
  }
}

/** Register one tool; its registration and all pending calls belong to this effect. */
export function apply(ctx) {
  ctx.effect(() => {
    const lifetime = new AbortController();
    const pending = new Set();
    let disposed = false;
    const assertLive = (signal) => {
      if (disposed) throw failure('FONT_PLUGIN_DISPOSED', 'The font manager plugin has been disposed.');
      signal.throwIfAborted();
    };
    const unregister = ctx.tools.register({
      name: 'font_manager',
      description: 'Read, apply, or reset text, code, and terminal fonts in the current DSH profile. '
        + 'Read returns the revision and font-only user overrides. Changes affect all sessions and require '
        + 'danger-full-access permission or one-call approval. Theme selection is never changed.',
      parameters: {
        type: 'object', additionalProperties: false, required: ['action'],
        properties: {
          action: { type: 'string', enum: ['read', 'apply', 'reset'], description: 'Read fonts, apply partial changes, or reset selected roles to inherited settings.' },
          changes: { type: 'object', additionalProperties: false, minProperties: 1, properties: roleProperties,
            description: 'For apply only: non-empty role map with family and/or size. Family is a comma-separated list (max 2048 characters; empty means built-in stack). Sizes are integer px: text 10–22, code 10–16, terminal 10–20.' },
          roles: { type: 'array', minItems: 1, maxItems: 3, uniqueItems: true, items: { type: 'string', enum: [...ROLES] },
            description: 'For reset only: roles whose family and size overrides will be unset.' },
          expectedRevision: { type: 'integer', minimum: 0, maximum: MAX_REVISION,
            description: 'Required for apply/reset: exact revision from the latest read. A conflict requires reading again; it is never retried automatically.' },
        },
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          required: ['action', 'namespace', 'revision', 'typography', 'userOverrides'],
          properties: {
            action: { type: 'string', enum: ['read', 'apply', 'reset'] },
            namespace: { type: 'string', const: NAMESPACE },
            revision: { type: 'integer' },
            typography: typographySchema, userOverrides: overrideSchema,
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      isConcurrencySafe: (args) => args?.action === 'read',
      async execute(args, exec) {
        const signal = exec.signal === undefined ? lifetime.signal : AbortSignal.any([exec.signal, lifetime.signal]);
        assertLive(signal);
        const task = (async () => {
          const request = parseArguments(args);
          const descriptor = descriptorOf(ctx);
          if (request.action === 'read') return snapshot(descriptor, request.action);
          checkRevision(descriptor, request.expectedRevision);
          // Bound the recoverable pre-write state before any approval or change.
          snapshot(descriptor, 'read');
          await approveWrite(ctx, request, exec, signal);
          assertLive(signal);
          // The user may have changed settings while the approval prompt was open.
          checkRevision(descriptorOf(ctx), request.expectedRevision);
          assertLive(signal);
          // Native mutate checks the SAME revision again under its write serialization.
          await ctx.settings.mutate(NAMESPACE, request.ops, request.expectedRevision);
          return snapshot(descriptorOf(ctx), request.action);
        })();
        pending.add(task);
        try { return await task; } finally { pending.delete(task); }
      },
    });
    return async () => {
      disposed = true;
      lifetime.abort(failure('FONT_PLUGIN_DISPOSED', 'The font manager plugin has been disposed.'));
      unregister();
      // A native settings write already dispatched has no AbortSignal parameter: drain it.
      await Promise.allSettled([...pending]);
    };
  });
}

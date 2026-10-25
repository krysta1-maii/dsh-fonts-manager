import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, inject } from '../index.js';
import { ROLES, ROLE_SPECS } from '../shared.js';

const initial = {
  preference: 'dark', fontSize: 14, codeFontSize: 11, terminalFontSize: 13,
  textFontFamily: '', codeFontFamily: '"Original Mono"', terminalFontFamily: '',
  unknownFutureThemeField: { preserve: true },
};

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture(options = {}) {
  const state = {
    revision: options.revision ?? 7,
    value: { ...structuredClone(initial), ...options.value },
    user: { preference: 'dark', codeFontFamily: '"Original Mono"', ...options.user },
    base: { ...structuredClone(initial), codeFontFamily: '', ...options.base },
  };
  const trace = [];
  const approvals = [];
  const writes = [];
  const registrations = new Map();
  const effects = [];
  const agent = { id: 'test-agent', session: { id: 'test-session' } };
  let tool;
  const ctx = {
    effect(callback) { effects.push(callback()); },
    tools: {
      register(definition) {
        assert.equal(registrations.has(definition.name), false);
        tool = definition;
        registrations.set(definition.name, definition);
        return () => { trace.push('unregister'); registrations.delete(definition.name); };
      },
    },
    settings: {
      describe(request) {
        assert.deepEqual(request, { redactSecrets: true });
        trace.push('describe');
        if (options.describe) return options.describe(state);
        return [
          { ns: 'credentials', revision: 2, value: { token: 'must-not-leak' }, user: { token: 'must-not-leak' } },
          { ns: 'ui-theme', revision: state.revision, value: structuredClone(state.value), user: structuredClone(state.user),
            base: structuredClone(state.base), schema: { extra: 'must-not-leak' }, secrets: [{ path: ['token'], set: true }] },
        ];
      },
      async mutate(ns, ops, expectedRevision) {
        trace.push('mutate');
        writes.push({ ns, ops: structuredClone(ops), expectedRevision });
        if (options.beforeMutate) await options.beforeMutate(state);
        if (state.revision !== expectedRevision) throw Object.assign(new Error('native revision conflict'), { code: 'NATIVE_CONFLICT' });
        assert.equal(ns, 'ui-theme');
        for (const op of ops) {
          assert.equal(op.path.length, 1);
          const field = op.path[0];
          assert.ok(ROLES.some((role) => [ROLE_SPECS[role].familyField, ROLE_SPECS[role].sizeField].includes(field)));
          if (op.op === 'set') {
            state.value[field] = op.value;
            state.user[field] = op.value;
          } else {
            assert.equal(op.op, 'unset');
            delete state.user[field];
            state.value[field] = state.base[field];
          }
        }
        state.revision += 1;
      },
    },
    sandboxPolicy: {
      resolve(request) {
        trace.push('policy');
        assert.deepEqual(request, options.agentless ? {} : { session: agent.session });
        return { mode: options.mode ?? 'workspace-write', workspaceRoot: '/workspace' };
      },
    },
    approval: {
      async request(request) {
        trace.push('approval');
        approvals.push(request);
        if (options.approval) return options.approval(request, state);
        return options.outcome ?? 'allowed-once';
      },
    },
  };
  apply(ctx);
  const exec = { agent: options.agentless ? undefined : agent, callId: 'call-1', signal: new AbortController().signal };
  return {
    ctx, state, trace, approvals, writes, registrations, effects, agent, tool,
    call: (args, overrides = {}) => tool.execute(args, { ...exec, ...overrides }),
    dispose: () => effects[0](),
  };
}

const change = (expectedRevision = 7) => ({ action: 'apply', expectedRevision, changes: { text: { size: 17 } } });

test('registers exactly one canonical tool within a disposable effect', async () => {
  const f = fixture();
  assert.deepEqual(inject, ['tools', 'settings', 'approval', 'sandboxPolicy']);
  assert.deepEqual([...f.registrations.keys()], ['font_manager']);
  assert.equal(f.effects.length, 1);
  assert.equal(f.tool.parameters.additionalProperties, false);
  assert.deepEqual(f.tool.output.schema.required, ['action', 'namespace', 'revision', 'typography', 'userOverrides']);
  assert.equal(f.tool.isConcurrencySafe({ action: 'read' }), true);
  assert.equal(f.tool.isConcurrencySafe(change()), false);
  assert.equal(f.tool.isConcurrencySafe(undefined), false);
  await f.dispose();
  assert.equal(f.registrations.size, 0);
});

test('canonical output uses only the inspected DSH JsonSchemaNode vocabulary', async () => {
  const f = fixture();
  const allowed = new Set(['type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'description', 'title', 'default', 'examples']);
  function visit(schema) {
    for (const key of Object.keys(schema)) assert.ok(allowed.has(key), 'Unsupported canonical output keyword: ' + key);
    for (const child of Object.values(schema.properties ?? {})) visit(child);
    for (const child of schema.oneOf ?? []) visit(child);
    if (schema.items) visit(schema.items);
  }
  visit(f.tool.output.schema);
  const result = await f.call({ action: 'read' });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  await f.dispose();
});

test('read is read-only, bounded and font-only, preserving raw user overrides for recovery', async () => {
  const f = fixture({ user: { fontSize: 16, textFontFamily: ' Raw Family ', terminalFontFamily: null, secret: 'never-output' } });
  const before = structuredClone(f.state);
  const result = await f.call({ action: 'read' });
  assert.deepEqual(result, {
    action: 'read', namespace: 'ui-theme', revision: 7,
    typography: { text: { family: '', size: 14 }, code: { family: '"Original Mono"', size: 11 }, terminal: { family: '', size: 13 } },
    userOverrides: { fontSize: 16, textFontFamily: ' Raw Family ', codeFontFamily: '"Original Mono"', terminalFontFamily: null },
  });
  assert.deepEqual(f.state, before);
  assert.deepEqual(f.trace, ['describe']);
  assert.equal(f.approvals.length, 0);
  assert.equal(f.writes.length, 0);
  const text = f.tool.output.render({ action: 'read' }, result);
  assert.deepEqual(JSON.parse(text[0].text), result);
  assert.equal(text[0].type, 'text');
  assert.doesNotMatch(text[0].text, /preference|secret|must-not-leak|unknownFutureThemeField/);
  await f.dispose();
});

test('apply uses exact approval identity, native mutation, revision, and normalized values', async () => {
  const f = fixture();
  const result = await f.call({ action: 'apply', expectedRevision: 7, changes: {
    text: { family: ' 思源宋体, serif ', size: 18 }, code: { family: 'JetBrains Mono' },
  } });
  assert.equal(result.revision, 8);
  assert.equal(result.action, 'apply');
  assert.deepEqual(result.typography.text, { family: '"思源宋体", serif', size: 18 });
  assert.equal(result.typography.code.family, '"JetBrains Mono"');
  assert.deepEqual(f.trace, ['describe', 'policy', 'approval', 'describe', 'mutate', 'describe']);
  assert.equal(f.approvals.length, 1);
  assert.equal(f.approvals[0].agent, f.agent);
  assert.equal(f.approvals[0].toolName, 'font_manager');
  assert.equal(f.approvals[0].callId, 'call-1');
  assert.ok(f.approvals[0].signal instanceof AbortSignal);
  assert.match(f.approvals[0].reason, /^escalate sandbox to danger-full-access:/);
  assert.match(f.approvals[0].reason, /expectedRevision/);
  assert.match(f.approvals[0].displayReason.zh, /所有会话/);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].expectedRevision, 7);
  assert.equal(f.state.value.preference, 'dark');
  assert.equal(f.state.user.preference, 'dark');
  assert.deepEqual(f.state.value.unknownFutureThemeField, { preserve: true });
  await f.dispose();
});

test('standing Full access follows native plugin_manager policy without prompting', async () => {
  const f = fixture({ mode: 'danger-full-access' });
  await f.call(change());
  assert.equal(f.approvals.length, 0);
  assert.equal(f.writes.length, 1);
  assert.equal(f.state.value.fontSize, 17);
  await f.dispose();
});

test('read-only mode asks for the same profile-wide one-call grant', async () => {
  const f = fixture({ mode: 'read-only' });
  await f.call(change());
  assert.equal(f.approvals.length, 1);
  assert.equal(f.writes.length, 1);
  await f.dispose();
});

test('reset unsets both selected fields and reveals inherited values without touching other roles or theme', async () => {
  const f = fixture({ value: { codeFontSize: 16, terminalFontSize: 19 }, user: { codeFontSize: 16, terminalFontSize: 19 },
    base: { codeFontSize: 12, codeFontFamily: '"Inherited Mono"' } });
  const result = await f.call({ action: 'reset', roles: ['code'], expectedRevision: 7 });
  assert.deepEqual(f.writes[0], { ns: 'ui-theme', expectedRevision: 7, ops: [
    { op: 'unset', path: ['codeFontFamily'] }, { op: 'unset', path: ['codeFontSize'] },
  ] });
  assert.deepEqual(result.typography.code, { family: '"Inherited Mono"', size: 12 });
  assert.equal(result.typography.terminal.size, 19);
  assert.equal(Object.hasOwn(result.userOverrides, 'codeFontSize'), false);
  assert.equal(Object.hasOwn(result.userOverrides, 'codeFontFamily'), false);
  assert.equal(f.state.value.preference, 'dark');
  assert.equal(f.state.user.preference, 'dark');
  await f.dispose();
});

test('all illegal tool input is rejected before reading settings, approval or mutation', async () => {
  const f = fixture();
  for (const args of [null, [], {}, { action: 'replace' }, { action: 'read', expectedRevision: 7 },
    { action: 'read', preference: 'light' }, { action: 'apply', changes: { text: { size: 17 } } },
    ...[-1, 1.5, '7', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map((revision) => change(revision)),
    { ...change(), roles: ['text'] }, { action: 'reset', expectedRevision: 7, roles: [] },
    { action: 'reset', expectedRevision: 7, roles: ['text', 'text'] },
    { action: 'reset', expectedRevision: 7, roles: ['preference'] },
    { action: 'reset', expectedRevision: 7, roles: ['text'], changes: {} },
    { action: 'apply', expectedRevision: 7, changes: {} },
    { action: 'apply', expectedRevision: 7, changes: { text: { size: 23 } } },
    { action: 'apply', expectedRevision: 7, changes: { text: { family: 'x'.repeat(2049) } } },
    { action: 'apply', expectedRevision: 7, changes: { preference: 'light' } },
    { action: 'apply', expectedRevision: 7, changes: { text: { size: 14, preference: 'light' } } },
    Object.create({ action: 'read' }), Object.defineProperty({}, 'action', { enumerable: true, get() { throw new Error('accessor'); } }),
  ]) await assert.rejects(f.call(args));
  assert.deepEqual(f.trace, []);
  assert.equal(f.writes.length, 0);
  assert.equal(f.approvals.length, 0);
  await f.dispose();
});

for (const outcome of ['rejected', 'cancelled', 'unavailable', 'rogue-outcome']) {
  test('approval ' + outcome + ' fails closed with no settings write', async () => {
    const f = fixture({ outcome });
    const before = structuredClone(f.state);
    await assert.rejects(f.call(change()), { code: 'FONT_APPROVAL_' + (outcome === 'rogue-outcome' ? 'UNAVAILABLE' : outcome.toUpperCase()) });
    assert.deepEqual(f.state, before);
    assert.equal(f.writes.length, 0);
    assert.equal(f.approvals.length, 1);
    await f.dispose();
  });
}

test('approval audit failure propagates without mutation or automatic retry', async () => {
  const auditError = new Error('approval log unavailable');
  const f = fixture({ approval: () => { throw auditError; } });
  await assert.rejects(f.call(change()), (error) => error === auditError);
  assert.equal(f.writes.length, 0);
  assert.equal(f.approvals.length, 1);
  await f.dispose();
});

test('missing agent or invalid sandbox mode fails closed, while read is still available', async () => {
  for (const options of [{ agentless: true }, { mode: 'invalid' }]) {
    const f = fixture(options);
    await f.call({ action: 'read' });
    await assert.rejects(f.call(change()), { code: 'FONT_APPROVAL_UNAVAILABLE' });
    assert.equal(f.writes.length, 0);
    assert.equal(f.approvals.length, 0);
    await f.dispose();
  }
});

test('stale expectedRevision is rejected before approval', async () => {
  const f = fixture({ revision: 8 });
  await assert.rejects(f.call(change()), { code: 'FONT_REVISION_CONFLICT' });
  assert.deepEqual(f.trace, ['describe']);
  assert.equal(f.writes.length, 0);
  await f.dispose();
});

test('a change while approval is pending is detected by a second pre-write read', async () => {
  const f = fixture({ approval: (_request, state) => {
    state.revision += 1;
    state.value.preference = 'light';
    state.user.preference = 'light';
    return 'allowed-once';
  } });
  await assert.rejects(f.call(change()), { code: 'FONT_REVISION_CONFLICT' });
  assert.equal(f.writes.length, 0);
  assert.equal(f.state.value.fontSize, 14);
  assert.equal(f.state.value.preference, 'light');
  assert.equal(f.state.user.preference, 'light');
  await f.dispose();
});

test('native atomic revision fencing receives the original revision and is not retried', async () => {
  const f = fixture({ beforeMutate: (state) => { state.revision += 1; } });
  await assert.rejects(f.call(change()), { code: 'NATIVE_CONFLICT' });
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].expectedRevision, 7);
  assert.equal(f.state.value.fontSize, 14);
  assert.equal(f.approvals.length, 1);
  await f.dispose();
});

test('arguments are snapshotted into approved ops before asynchronous approval', async () => {
  const args = change();
  const f = fixture({ approval: () => {
    args.changes.text.size = 22;
    args.changes.preference = 'light';
    return 'allowed-once';
  } });
  await f.call(args);
  assert.equal(f.state.value.fontSize, 17);
  assert.equal(f.state.value.preference, 'dark');
  await f.dispose();
});

test('already-aborted calls perform no reads or writes', async () => {
  const controller = new AbortController();
  const cancellation = new Error('user cancelled');
  controller.abort(cancellation);
  const f = fixture();
  await assert.rejects(f.call(change(), { signal: controller.signal }), (error) => error === cancellation);
  assert.deepEqual(f.trace, []);
  await f.dispose();
});

test('cancellation during an approval prevents mutation even with a late allowed answer', async () => {
  const controller = new AbortController();
  const cancellation = new Error('user cancelled');
  const f = fixture({ approval: () => { controller.abort(cancellation); return 'allowed-once'; } });
  await assert.rejects(f.call(change(), { signal: controller.signal }), (error) => error === cancellation);
  assert.equal(f.approvals[0].signal.aborted, true);
  assert.equal(f.writes.length, 0);
  await f.dispose();
});

test('disposing during pending approval aborts it and unregisters without writing', async () => {
  const asked = deferred();
  const f = fixture({ approval: (request) => {
    asked.resolve();
    return new Promise((resolve) => request.signal.addEventListener('abort', () => resolve('cancelled'), { once: true }));
  } });
  const execution = f.call(change());
  const rejected = assert.rejects(execution, { code: 'FONT_APPROVAL_CANCELLED' });
  await asked.promise;
  await f.dispose();
  await rejected;
  assert.equal(f.registrations.size, 0);
  assert.equal(f.approvals[0].signal.aborted, true);
  assert.equal(f.writes.length, 0);
  await assert.rejects(f.call({ action: 'read' }), { code: 'FONT_PLUGIN_DISPOSED' });
});

test('disposal prevents late approval grants from starting a settings mutation', async () => {
  const asked = deferred();
  const grant = deferred();
  const f = fixture({ approval: () => { asked.resolve(); return grant.promise; } });
  const execution = f.call(change());
  const rejected = assert.rejects(execution, { code: 'FONT_PLUGIN_DISPOSED' });
  await asked.promise;
  const disposal = f.dispose();
  grant.resolve('allowed-once');
  await Promise.all([disposal, rejected]);
  assert.equal(f.writes.length, 0);
});

test('dispose drains a native mutation already dispatched instead of claiming cancellation', async () => {
  const started = deferred();
  const finish = deferred();
  const f = fixture({ beforeMutate: async () => { started.resolve(); await finish.promise; } });
  const execution = f.call(change());
  await started.promise;
  let drained = false;
  const disposal = f.dispose().then(() => { drained = true; });
  await Promise.resolve();
  assert.equal(drained, false);
  assert.equal(f.registrations.size, 0);
  await assert.rejects(f.call(change()), { code: 'FONT_PLUGIN_DISPOSED' });
  finish.resolve();
  const result = await execution;
  await disposal;
  assert.equal(drained, true);
  assert.equal(result.revision, 8);
  assert.equal(f.state.value.fontSize, 17);
  assert.equal(f.writes.length, 1);
});

test('missing, duplicate, or malformed namespace descriptors fail without fallback writes', async () => {
  for (const describe of [() => [], () => [{ ns: 'include:ui-theme', revision: 7 }],
    () => [{ ns: 'ui-theme', revision: 7 }, { ns: 'ui-theme', revision: 7 }],
    () => [{ ns: 'ui-theme', revision: NaN }]]) {
    const f = fixture({ describe });
    await assert.rejects(f.call(change()), { code: 'FONT_SETTINGS_UNAVAILABLE' });
    assert.equal(f.writes.length, 0);
    assert.equal(f.approvals.length, 0);
    await f.dispose();
  }
});

test('existing oversized or expression overrides are refused rather than silently truncated', async () => {
  for (const options of [{ value: { textFontFamily: 'x'.repeat(2049) } },
    { user: { textFontFamily: 'x'.repeat(2049) } }, { user: { fontSize: { __jsExpr: '14' } } }]) {
    const f = fixture(options);
    await assert.rejects(f.call({ action: 'read' }), { code: 'FONT_STATE_UNSUPPORTED' });
    await assert.rejects(f.call(change()), { code: 'FONT_STATE_UNSUPPORTED' });
    assert.equal(f.writes.length, 0);
    assert.equal(f.approvals.length, 0);
    await f.dispose();
  }
});

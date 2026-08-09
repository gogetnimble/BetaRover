/**
 * Mock-execution runner: interprets a flow definition against a {@link TestCase}
 * and evaluates its assertions. Connector / child-flow / HTTP actions are never
 * called — their outputs come from the case's `mocks`, or default to an empty
 * successful result (and are reported in {@link TestResult.unmockedExternal}).
 *
 * Supported control flow: `runAfter` ordering + status gating, Scope, Condition
 * (`If`), Foreach, Switch, Terminate, and the variable/Compose actions.
 * Documented limits: `Until` runs its body once; parallel branches are executed
 * in a deterministic order; expression coverage is the subset in `expr.ts`.
 */
import type { FlowModel } from '../types.js';
import type { ActionStatus, ActionTrace, Assertion, AssertionResult, MockAction, TestCase, TestResult } from './types.js';
import { emptyContext, resolveValue, evaluateExpression, toBool } from './expr.js';
import type { EvalContext } from './expr.js';

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
const asStrArr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const toNum = (v: unknown): number => (typeof v === 'number' ? v : Number(v));

interface State {
  ctx: EvalContext;
  trace: ActionTrace[];
  statuses: Record<string, ActionStatus>;
  branches: Record<string, 'yes' | 'no'>;
  mocks: Record<string, MockAction>;
  unmocked: Set<string>;
  terminated: { status: ActionStatus } | null;
}

const EXTERNAL_TYPES = new Set([
  'openapiconnection', 'openapiconnectionwebhook', 'openapiconnectionnotification',
  'apiconnection', 'apiconnectionwebhook', 'http', 'https', 'workflow', 'function',
  'sendemail', 'sendemailv2', 'response',
]);

export function runTestCase(model: FlowModel, testCase: TestCase): TestResult {
  const def = asRecord(model.raw);
  const ctx = emptyContext();
  ctx.trigger.outputs = testCase.trigger?.outputs;
  ctx.trigger.body = testCase.trigger?.body ?? asRecord(testCase.trigger?.outputs).body;
  if (testCase.variables) ctx.variables = { ...testCase.variables };

  const state: State = { ctx, trace: [], statuses: {}, branches: {}, mocks: testCase.mocks ?? {}, unmocked: new Set(), terminated: null };
  runScope(asRecord(def.actions), state);

  const assertions = testCase.asserts.map((a) => evalAssertion(a, state));
  return {
    caseName: testCase.name,
    passed: assertions.every((x) => x.passed),
    assertions,
    trace: state.trace,
    unmockedExternal: [...state.unmocked],
  };
}

interface ScopeOutcome { status: ActionStatus; children: Array<{ name: string; status: ActionStatus; outputs?: unknown }>; }

function runScope(actionsMap: Record<string, unknown>, state: State): ScopeOutcome {
  const entries = Object.entries(actionsMap);
  const local: Record<string, ActionStatus> = {};
  const done = new Set<string>();
  const children: ScopeOutcome['children'] = [];
  let progress = true;
  while (done.size < entries.length && progress) {
    progress = false;
    for (const [name, raw] of entries) {
      if (done.has(name)) continue;
      const action = asRecord(raw);
      const runAfter = asRecord(action.runAfter);
      const deps = Object.keys(runAfter);
      if (!deps.every((d) => done.has(d))) continue; // wait for predecessors

      let status: ActionStatus;
      const gated = deps.some((d) => !asStrArr(runAfter[d]).includes(local[d] ?? 'Skipped'));
      if (state.terminated || gated) {
        status = 'Skipped';
        pushTrace(state, { name, type: String(action.type ?? 'Unknown'), status });
        markSkipped(action, state); // cascade Skipped into nested actions
      } else {
        status = executeAction(name, action, state);
      }
      local[name] = status;
      state.statuses[name] = status;
      done.add(name);
      children.push({ name, status, outputs: state.ctx.outputs[name] });
      progress = true;
    }
  }
  const anyFailed = entries.some(([n]) => local[n] === 'Failed' || local[n] === 'TimedOut');
  return { status: anyFailed ? 'Failed' : 'Succeeded', children };
}

function executeAction(name: string, action: Record<string, unknown>, state: State): ActionStatus {
  const type = String(action.type ?? 'Unknown').toLowerCase();
  const mock = state.mocks[name];

  if (mock) {
    const status: ActionStatus = mock.status ?? (mock.error ? 'Failed' : 'Succeeded');
    setOutput(name, mock.outputs, state);
    pushTrace(state, { name, type: String(action.type), status, output: mock.outputs, mocked: true, note: mock.error });
    return status;
  }

  switch (type) {
    case 'compose': {
      const out = resolveValue(action.inputs, state.ctx);
      setOutput(name, out, state);
      pushTrace(state, { name, type: String(action.type), status: 'Succeeded', output: out });
      return 'Succeeded';
    }
    case 'initializevariable': {
      for (const v of asArray(asRecord(action.inputs).variables)) {
        const vv = asRecord(v);
        state.ctx.variables[String(vv.name)] = vv.value === undefined ? defaultForType(vv.type) : resolveValue(vv.value, state.ctx);
      }
      pushTrace(state, { name, type: String(action.type), status: 'Succeeded' });
      return 'Succeeded';
    }
    case 'setvariable': {
      const inp = asRecord(action.inputs);
      state.ctx.variables[String(inp.name)] = resolveValue(inp.value, state.ctx);
      pushTrace(state, { name, type: String(action.type), status: 'Succeeded' });
      return 'Succeeded';
    }
    case 'incrementvariable':
    case 'decrementvariable': {
      const inp = asRecord(action.inputs);
      const cur = toNum(state.ctx.variables[String(inp.name)] ?? 0);
      const by = toNum(resolveValue(inp.value ?? 1, state.ctx));
      state.ctx.variables[String(inp.name)] = type === 'incrementvariable' ? cur + by : cur - by;
      pushTrace(state, { name, type: String(action.type), status: 'Succeeded' });
      return 'Succeeded';
    }
    case 'appendtoarrayvariable':
    case 'appendtostringvariable': {
      const inp = asRecord(action.inputs);
      const key = String(inp.name);
      const val = resolveValue(inp.value, state.ctx);
      if (type === 'appendtoarrayvariable') {
        const arr = Array.isArray(state.ctx.variables[key]) ? (state.ctx.variables[key] as unknown[]) : [];
        arr.push(val); state.ctx.variables[key] = arr;
      } else {
        state.ctx.variables[key] = String(state.ctx.variables[key] ?? '') + String(val);
      }
      pushTrace(state, { name, type: String(action.type), status: 'Succeeded' });
      return 'Succeeded';
    }
    case 'scope': {
      const outcome = runScope(asRecord(action.actions), state);
      state.ctx.results[name] = outcome.children.map((c) => ({ name: c.name, status: c.status, outputs: c.outputs }));
      pushTrace(state, { name, type: String(action.type), status: outcome.status });
      return outcome.status;
    }
    case 'if': {
      const yes = evalCondition(action.expression, state.ctx);
      const branch: 'yes' | 'no' = yes ? 'yes' : 'no';
      state.branches[name] = branch;
      const body = yes ? asRecord(action.actions) : asRecord(asRecord(action.else).actions);
      pushTrace(state, { name, type: String(action.type), status: 'Succeeded', branch });
      const outcome = runScope(body, state);
      state.statuses[name] = outcome.status;
      return outcome.status;
    }
    case 'foreach': {
      const arr = resolveValue(action.foreach, state.ctx);
      const items = Array.isArray(arr) ? arr : [];
      let status: ActionStatus = 'Succeeded';
      for (const it of items) {
        state.ctx.currentItem = it; state.ctx.items[name] = it;
        const outcome = runScope(asRecord(action.actions), state);
        if (outcome.status === 'Failed') status = 'Failed';
      }
      pushTrace(state, { name, type: String(action.type), status });
      return status;
    }
    case 'switch': {
      const val = resolveValue(action.expression, state.ctx);
      const cases = asRecord(action.cases);
      let branch = asRecord(asRecord(action.default).actions);
      for (const c of Object.values(cases)) {
        const cr = asRecord(c);
        if (String(resolveValue(cr.case, state.ctx)) === String(val)) { branch = asRecord(cr.actions); break; }
      }
      pushTrace(state, { name, type: String(action.type), status: 'Succeeded' });
      return runScope(branch, state).status;
    }
    case 'terminate': {
      const runStatus = String(asRecord(action.inputs).runStatus ?? 'Cancelled');
      const status: ActionStatus = runStatus === 'Failed' ? 'Failed' : 'Succeeded';
      state.terminated = { status };
      pushTrace(state, { name, type: String(action.type), status });
      return status;
    }
    default: {
      if (EXTERNAL_TYPES.has(type)) {
        state.unmocked.add(name);
        setOutput(name, {}, state);
        pushTrace(state, { name, type: String(action.type), status: 'Succeeded', output: {}, note: 'external action assumed Succeeded — provide a mock for real coverage' });
        return 'Succeeded';
      }
      pushTrace(state, { name, type: String(action.type), status: 'Succeeded' });
      return 'Succeeded';
    }
  }
}

/* structured OR string condition */
function evalCondition(expr: unknown, ctx: EvalContext): boolean {
  if (typeof expr === 'string') return toBool(resolveValue(expr, ctx));
  const obj = asRecord(expr);
  const key = Object.keys(obj)[0];
  if (!key) return false;
  const raw = obj[key];
  const list = Array.isArray(raw) ? raw : [raw];
  switch (key) {
    case 'and': return list.every((e) => evalCondition(e, ctx));
    case 'or': return list.some((e) => evalCondition(e, ctx));
    case 'not': return !evalCondition(list[0], ctx);
    default: {
      const a = resolveValue(list[0], ctx); const b = resolveValue(list[1], ctx);
      return compare(key, a, b);
    }
  }
}
function compare(op: string, a: unknown, b: unknown): boolean {
  switch (op) {
    case 'equals': return JSON.stringify(a) === JSON.stringify(b);
    case 'notequals': return JSON.stringify(a) !== JSON.stringify(b);
    case 'greater': return toNum(a) > toNum(b);
    case 'greaterorequals': return toNum(a) >= toNum(b);
    case 'less': return toNum(a) < toNum(b);
    case 'lessorequals': return toNum(a) <= toNum(b);
    case 'contains': return Array.isArray(a) ? a.some((x) => JSON.stringify(x) === JSON.stringify(b)) : String(a).includes(String(b));
    case 'startswith': return String(a).startsWith(String(b));
    case 'endswith': return String(a).endsWith(String(b));
    default: return false;
  }
}

/* mark every nested action of a skipped block as Skipped so assertions see it */
function markSkipped(action: Record<string, unknown>, state: State): void {
  const nested: unknown[] = [action.actions, asRecord(action.else).actions, asRecord(action.default).actions];
  for (const c of Object.values(asRecord(action.cases))) nested.push(asRecord(c).actions);
  for (const n of nested) {
    for (const [name, raw] of Object.entries(asRecord(n))) {
      state.statuses[name] = 'Skipped';
      pushTrace(state, { name, type: String(asRecord(raw).type ?? 'Unknown'), status: 'Skipped' });
      markSkipped(asRecord(raw), state);
    }
  }
}

function setOutput(name: string, outputs: unknown, state: State): void {
  state.ctx.outputs[name] = outputs;
  state.ctx.bodies[name] = outputs && typeof outputs === 'object' && 'body' in (outputs as object)
    ? (outputs as Record<string, unknown>).body : outputs;
}
function pushTrace(state: State, t: ActionTrace): void { state.trace.push(t); }
function asArray(v: unknown): unknown[] { return Array.isArray(v) ? v : v == null ? [] : [v]; }
function defaultForType(t: unknown): unknown {
  switch (String(t).toLowerCase()) {
    case 'array': return []; case 'object': return {}; case 'integer': case 'float': return 0;
    case 'boolean': return false; default: return '';
  }
}

/* ------------------------------ assertions ------------------------------ */
function evalAssertion(a: Assertion, state: State): AssertionResult {
  const ran = (n: string) => { const s = state.statuses[n]; return s !== undefined && s !== 'Skipped'; };
  const ok = (passed: boolean, message: string): AssertionResult => ({ assertion: a, passed, message });
  switch (a.type) {
    case 'ran': return ok(ran(a.action), ran(a.action) ? `${a.action} ran` : `${a.action} did not run (status ${state.statuses[a.action] ?? 'absent'})`);
    case 'skipped': { const sk = (state.statuses[a.action] ?? 'Skipped') === 'Skipped'; return ok(sk, sk ? `${a.action} was skipped` : `${a.action} ran (status ${state.statuses[a.action]})`); }
    case 'status': { const s = state.statuses[a.action]; return ok(s === a.equals, `${a.action} status = ${s ?? 'absent'} (expected ${a.equals})`); }
    case 'branchTaken': { const b = state.branches[a.condition]; return ok(b === a.branch, `${a.condition} took '${b ?? 'none'}' (expected '${a.branch}')`); }
    case 'variableEquals': { const v = state.ctx.variables[a.name]; const p = JSON.stringify(v) === JSON.stringify(a.equals); return ok(p, `variables('${a.name}') = ${JSON.stringify(v)} (expected ${JSON.stringify(a.equals)})`); }
    case 'outputEquals':
    case 'expression': {
      let val: unknown; let err = '';
      try { const e = a.expression.startsWith('@') ? a.expression.slice(1) : a.expression; val = evaluateExpression(e, state.ctx); }
      catch (x) { err = (x as Error).message; }
      if (err) return ok(false, `expression '${a.expression}' failed: ${err}`);
      const p = JSON.stringify(val) === JSON.stringify(a.equals);
      return ok(p, `${a.expression} = ${JSON.stringify(val)} (expected ${JSON.stringify(a.equals)})`);
    }
    case 'noFailures': {
      const failed = Object.entries(state.statuses).filter(([, s]) => s === 'Failed' || s === 'TimedOut').map(([n]) => n);
      return ok(failed.length === 0, failed.length ? `actions failed: ${failed.join(', ')}` : 'no actions failed');
    }
  }
}

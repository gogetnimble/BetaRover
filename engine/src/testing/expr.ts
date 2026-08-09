/**
 * A pragmatic evaluator for the Power Automate / Azure Logic Apps **Workflow
 * Definition Language** (WDL) expression subset used by the mock runner.
 *
 * Supports: references (`variables`, `outputs`, `body`, `triggerBody`,
 * `triggerOutputs`, `item`, `items`, `parameters`, `result`), a curated set of
 * built-in functions, `?[...]` / `[...]` / `.prop` indexing, string
 * interpolation (`@{…}`), and whole-expression strings (`@…`).
 *
 * Out of scope (documented limitation): the full function library, XPath, and
 * locale-sensitive formatting. Unknown functions throw, so a test surfaces them
 * rather than passing silently.
 */

export interface EvalContext {
  trigger: { outputs: unknown; body: unknown };
  outputs: Record<string, unknown>;
  bodies: Record<string, unknown>;
  variables: Record<string, unknown>;
  results: Record<string, unknown>;
  items: Record<string, unknown>;
  currentItem?: unknown;
  parameters?: Record<string, unknown>;
}

export function emptyContext(): EvalContext {
  return { trigger: { outputs: undefined, body: undefined }, outputs: {}, bodies: {}, variables: {}, results: {}, items: {} };
}

/* ----------------------------- tokenizer ----------------------------- */
type Tok = { t: 'id' | 'str' | 'num' | 'punct'; v: string };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src.charAt(i);
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === "'") {
      let s = ''; i++;
      while (i < n) {
        const d = src.charAt(i);
        if (d === "'") { if (src.charAt(i + 1) === "'") { s += "'"; i += 2; continue; } i++; break; }
        s += d; i++;
      }
      toks.push({ t: 'str', v: s });
      continue;
    }
    if (c >= '0' && c <= '9') {
      let num = '';
      while (i < n && /[0-9.]/.test(src.charAt(i))) { num += src.charAt(i); i++; }
      toks.push({ t: 'num', v: num });
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let id = '';
      while (i < n && /[A-Za-z0-9_$]/.test(src.charAt(i))) { id += src.charAt(i); i++; }
      toks.push({ t: 'id', v: id });
      continue;
    }
    // punctuation, including the two-char '?[' and '?.'
    if (c === '?' && (src.charAt(i + 1) === '[' || src.charAt(i + 1) === '.')) { toks.push({ t: 'punct', v: '?' + src.charAt(i + 1) }); i += 2; continue; }
    if ('()[],.'.includes(c)) { toks.push({ t: 'punct', v: c }); i++; continue; }
    throw new Error(`Unexpected character '${c}' in expression`);
  }
  return toks;
}

/* ------------------------------- parser ------------------------------ */
type Ast =
  | { k: 'lit'; value: unknown }
  | { k: 'call'; name: string; args: Ast[] }
  | { k: 'index'; target: Ast; key: Ast; optional: boolean }
  | { k: 'prop'; target: Ast; name: string; optional: boolean };

function parse(src: string): Ast {
  const toks = tokenize(src);
  let p = 0;
  const peek = (): Tok | undefined => toks[p];
  const next = (): Tok | undefined => toks[p++];
  const expect = (v: string) => { const t = next(); if (!t || t.v !== v) throw new Error(`Expected '${v}' in expression`); };

  function parsePrimary(): Ast {
    const t = next();
    if (!t) throw new Error('Unexpected end of expression');
    if (t.t === 'str') return { k: 'lit', value: t.v };
    if (t.t === 'num') return { k: 'lit', value: Number(t.v) };
    if (t.t === 'id') {
      if (t.v === 'true') return { k: 'lit', value: true };
      if (t.v === 'false') return { k: 'lit', value: false };
      if (t.v === 'null') return { k: 'lit', value: null };
      expect('(');
      const args: Ast[] = [];
      let pk = peek();
      if (pk && pk.v !== ')') {
        args.push(parseExpr());
        pk = peek();
        while (pk && pk.v === ',') { next(); args.push(parseExpr()); pk = peek(); }
      }
      expect(')');
      return { k: 'call', name: t.v, args };
    }
    throw new Error(`Unexpected token '${t.v}' in expression`);
  }

  function parseExpr(): Ast {
    let node = parsePrimary();
    let pk = peek();
    while (pk) {
      const v = pk.v;
      if (v === '[' || v === '?[') { const optional = v === '?['; next(); const key = parseExpr(); expect(']'); node = { k: 'index', target: node, key, optional }; }
      else if (v === '.' || v === '?.') { const optional = v === '?.'; next(); const id = next(); if (!id) throw new Error('Expected property name'); node = { k: 'prop', target: node, name: id.v, optional }; }
      else break;
      pk = peek();
    }
    return node;
  }

  const ast = parseExpr();
  if (p !== toks.length) throw new Error('Trailing tokens in expression');
  return ast;
}

/* ---------------------------- evaluation ----------------------------- */
const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (typeof a !== typeof b) {
    // Logic Apps compares numbers/strings loosely in some cases; keep it strict but allow number/string of equal text.
    return false;
  }
  if (a && b && typeof a === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return false;
};
const toStr = (v: unknown): string => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const toNum = (v: unknown): number => (typeof v === 'number' ? v : Number(v));
const isEmpty = (v: unknown): boolean =>
  v === null || v === undefined || v === '' ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && Object.keys(v as object).length === 0);

type Fn = (ctx: EvalContext, a: unknown[]) => unknown;
const FUNCTIONS: Record<string, Fn> = {
  // references
  variables: (c, a) => c.variables[String(a[0])],
  outputs: (c, a) => c.outputs[String(a[0])],
  body: (c, a) => c.bodies[String(a[0])],
  triggeroutputs: (c) => c.trigger.outputs,
  triggerbody: (c) => c.trigger.body,
  trigger: (c) => ({ outputs: c.trigger.outputs }),
  item: (c) => c.currentItem,
  items: (c, a) => c.items[String(a[0])],
  result: (c, a) => c.results[String(a[0])],
  parameters: (c, a) => (c.parameters ? c.parameters[String(a[0])] : undefined),
  actions: (c, a) => ({ outputs: c.outputs[String(a[0])], body: c.bodies[String(a[0])] }),
  // conversion
  string: (_c, a) => toStr(a[0]),
  int: (_c, a) => Math.trunc(toNum(a[0])),
  float: (_c, a) => toNum(a[0]),
  bool: (_c, a) => toBool(a[0]),
  json: (_c, a) => (typeof a[0] === 'string' ? JSON.parse(a[0] as string) : a[0]),
  array: (_c, a) => (Array.isArray(a[0]) ? a[0] : [a[0]]),
  createarray: (_c, a) => a.slice(),
  // logic
  if: (_c, a) => (toBool(a[0]) ? a[1] : a[2]),
  equals: (_c, a) => deepEqual(a[0], a[1]),
  not: (_c, a) => !toBool(a[0]),
  and: (_c, a) => a.every(toBool),
  or: (_c, a) => a.some(toBool),
  greater: (_c, a) => toNum(a[0]) > toNum(a[1]),
  greaterorequals: (_c, a) => toNum(a[0]) >= toNum(a[1]),
  less: (_c, a) => toNum(a[0]) < toNum(a[1]),
  lessorequals: (_c, a) => toNum(a[0]) <= toNum(a[1]),
  coalesce: (_c, a) => a.find((x) => x !== null && x !== undefined),
  empty: (_c, a) => isEmpty(a[0]),
  // string
  concat: (_c, a) => a.map(toStr).join(''),
  tolower: (_c, a) => toStr(a[0]).toLowerCase(),
  toupper: (_c, a) => toStr(a[0]).toUpperCase(),
  trim: (_c, a) => toStr(a[0]).trim(),
  replace: (_c, a) => toStr(a[0]).split(toStr(a[1])).join(toStr(a[2])),
  substring: (_c, a) => toStr(a[0]).substr(toNum(a[1]), a[2] === undefined ? undefined : toNum(a[2])),
  startswith: (_c, a) => toStr(a[0]).startsWith(toStr(a[1])),
  endswith: (_c, a) => toStr(a[0]).endsWith(toStr(a[1])),
  indexof: (_c, a) => toStr(a[0]).indexOf(toStr(a[1])),
  guid: () => '00000000-0000-0000-0000-000000000000',
  // collection
  length: (_c, a) => (Array.isArray(a[0]) ? a[0].length : toStr(a[0]).length),
  first: (_c, a) => (Array.isArray(a[0]) ? a[0][0] : toStr(a[0])[0]),
  last: (_c, a) => (Array.isArray(a[0]) ? a[0][a[0].length - 1] : toStr(a[0]).slice(-1)),
  contains: (_c, a) => {
    const hay = a[0];
    if (Array.isArray(hay)) return hay.some((x) => deepEqual(x, a[1]));
    if (hay && typeof hay === 'object') return Object.prototype.hasOwnProperty.call(hay, String(a[1]));
    return toStr(hay).includes(toStr(a[1]));
  },
  // math
  add: (_c, a) => toNum(a[0]) + toNum(a[1]),
  sub: (_c, a) => toNum(a[0]) - toNum(a[1]),
  mul: (_c, a) => toNum(a[0]) * toNum(a[1]),
  div: (_c, a) => toNum(a[0]) / toNum(a[1]),
  mod: (_c, a) => toNum(a[0]) % toNum(a[1]),
  max: (_c, a) => Math.max(...a.map(toNum)),
  min: (_c, a) => Math.min(...a.map(toNum)),
  // deterministic time (documented): fixed so tests are repeatable
  utcnow: () => '2020-01-01T00:00:00Z',
};

export function toBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.toLowerCase() === 'true';
  return !!v;
}

function evalAst(ast: Ast, ctx: EvalContext): unknown {
  switch (ast.k) {
    case 'lit': return ast.value;
    case 'call': {
      const fn = FUNCTIONS[ast.name.toLowerCase()];
      if (!fn) throw new Error(`Unsupported function '${ast.name}()'`);
      return fn(ctx, ast.args.map((a) => evalAst(a, ctx)));
    }
    case 'index': {
      const target = evalAst(ast.target, ctx);
      if (target === null || target === undefined) { if (ast.optional) return undefined; return undefined; }
      const key = evalAst(ast.key, ctx);
      return (target as Record<string, unknown>)[key as string];
    }
    case 'prop': {
      const target = evalAst(ast.target, ctx);
      if (target === null || target === undefined) return undefined;
      return (target as Record<string, unknown>)[ast.name];
    }
  }
}

/** Evaluate a single WDL expression body (the text after `@`). */
export function evaluateExpression(expr: string, ctx: EvalContext): unknown {
  return evalAst(parse(expr), ctx);
}

/**
 * Resolve a value from a flow definition: strings may be literals, whole
 * expressions (`@expr`), interpolations (`text @{expr} text`) or escaped
 * (`@@literal`). Objects/arrays are resolved deeply.
 */
export function resolveValue(value: unknown, ctx: EvalContext): unknown {
  if (Array.isArray(value)) return value.map((v) => resolveValue(v, ctx));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveValue(v, ctx);
    return out;
  }
  if (typeof value !== 'string') return value;
  const s = value;
  if (s.startsWith('@@')) return s.slice(1);
  if (s.startsWith('@') && !s.startsWith('@{')) return evaluateExpression(s.slice(1), ctx);
  if (!s.includes('@{')) return s;
  // interpolation
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] === '@' && s[i + 1] === '@') { out += '@'; i += 2; continue; }
    if (s[i] === '@' && s[i + 1] === '{') {
      let depth = 1; let j = i + 2; let expr = '';
      while (j < s.length && depth > 0) {
        if (s[j] === '{') depth++;
        else if (s[j] === '}') { depth--; if (depth === 0) break; }
        expr += s[j++];
      }
      out += toStr(evaluateExpression(expr, ctx));
      i = j + 1;
      continue;
    }
    out += s[i++];
  }
  return out;
}

/** Evaluate a WDL expression to a boolean (for interpolation-free assertions). */
export function evaluateBoolean(expr: string, ctx: EvalContext): boolean {
  return toBool(resolveValue(expr.startsWith('@') ? expr : '@' + expr, ctx));
}

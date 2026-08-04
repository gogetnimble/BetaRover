/**
 * Parsing of a Power Automate flow's `clientdata` into a normalised
 * {@link FlowModel}. The engine's evaluators work against this model rather than
 * the raw JSON so that the many shape variations of `clientdata` are handled in
 * exactly one place.
 */
import type { FlowAction, FlowModel, FlowTrigger } from './types.js';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * `clientdata` appears in the wild in several shapes:
 *   - `{ properties: { definition: {...}, connectionReferences: {...} } }`
 *   - `{ definition: {...} }`
 *   - a bare definition object with `triggers` / `actions`
 * plus any of the above as a JSON *string*. This locates the definition and the
 * connection references regardless of wrapper.
 */
function unwrap(clientData: unknown): {
  definition: Record<string, unknown>;
  connectionReferences: Record<string, unknown>;
} {
  let root: unknown = clientData;
  if (typeof root === 'string') {
    try {
      root = JSON.parse(root);
    } catch {
      root = {};
    }
  }
  const obj = asRecord(root);
  const props = asRecord(obj.properties);

  const definition = asRecord(
    props.definition ?? obj.definition ?? (obj.triggers || obj.actions ? obj : {}),
  );
  const connectionReferences = asRecord(
    props.connectionReferences ?? obj.connectionReferences,
  );
  return { definition, connectionReferences };
}

function normaliseRunAfter(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(asRecord(raw))) {
    out[key] = Array.isArray(value) ? value.map((s) => String(s)) : [];
  }
  return out;
}

/**
 * Recursively walk an `actions` map. Power Automate nests actions inside Scope,
 * Condition (`actions` / `else.actions`), Foreach (`actions`), Until, Switch
 * (`cases.*.actions` / `default.actions`) and Try/Catch scopes.
 */
function walkActions(
  actionsMap: unknown,
  parentPath: string,
  flat: FlowAction[],
): FlowAction[] {
  const result: FlowAction[] = [];
  for (const [name, rawAction] of Object.entries(asRecord(actionsMap))) {
    const action = asRecord(rawAction);
    const path = parentPath ? `${parentPath}/${name}` : name;

    const children: FlowAction[] = [];
    // Direct nested actions (Scope, Foreach, Until, Condition-if).
    const nested: unknown[] = [action.actions];
    // Condition else branch.
    const elseBranch = asRecord(action.else);
    nested.push(elseBranch.actions);
    // Switch cases + default.
    for (const c of Object.values(asRecord(action.cases))) {
      nested.push(asRecord(c).actions);
    }
    nested.push(asRecord(action.default).actions);

    const node: FlowAction = {
      name,
      type: String(action.type ?? 'Unknown'),
      runAfter: normaliseRunAfter(action.runAfter),
      inputs: action.inputs,
      path,
      children,
      raw: action,
    };
    flat.push(node);
    for (const n of nested) {
      if (n) children.push(...walkActions(n, path, flat));
    }
    result.push(node);
  }
  return result;
}

export function parseFlow(displayName: string, clientData: unknown): FlowModel {
  const { definition, connectionReferences } = unwrap(clientData);

  const triggers: FlowTrigger[] = Object.entries(asRecord(definition.triggers)).map(
    ([name, raw]) => {
      const t = asRecord(raw);
      return { name, type: String(t.type ?? 'Unknown'), inputs: t.inputs, raw: t };
    },
  );

  const flat: FlowAction[] = [];
  const topLevelActions = walkActions(definition.actions, '', flat);

  return {
    displayName,
    triggers,
    topLevelActions,
    allActions: flat,
    connectionReferences,
    raw: definition,
  };
}

/** Small utilities shared by the deterministic evaluators. */
import type { FlowAction, Finding, EvaluatorContext } from '../types.js';

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Read a string parameter from a rule's parameters, with a fallback. */
export function strParam(params: Record<string, unknown>, key: string, fallback: string): string {
  const v = params[key];
  return typeof v === 'string' ? v : fallback;
}

/** Read a string[] parameter from a rule's parameters, with a fallback. */
export function arrParam(params: Record<string, unknown>, key: string, fallback: string[]): string[] {
  const v = params[key];
  return Array.isArray(v) ? v.map((x) => String(x)) : fallback;
}

export function boolParam(params: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = params[key];
  return typeof v === 'boolean' ? v : fallback;
}

/** The `host` block of an OpenApiConnection action's inputs. */
export function actionHost(action: FlowAction): Record<string, unknown> {
  return asRecord(asRecord(action.inputs).host);
}

/** The `parameters` block of an OpenApiConnection action's inputs. */
export function actionParameters(action: FlowAction): Record<string, unknown> {
  return asRecord(asRecord(action.inputs).parameters);
}

export function operationId(action: FlowAction): string {
  return String(actionHost(action).operationId ?? '');
}

export function apiId(action: FlowAction): string {
  return String(actionHost(action).apiId ?? '');
}

/** Case-insensitive set equality between two string arrays. */
export function sameStatusSet(a: string[], b: string[]): boolean {
  const norm = (arr: string[]) => new Set(arr.map((s) => s.toLowerCase()));
  const sa = norm(a);
  const sb = norm(b);
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Build a finding using the rule's declared metadata for the shared fields. */
export function finding(
  ctx: EvaluatorContext,
  status: Finding['status'],
  message: string,
  extra?: Partial<Pick<Finding, 'evidence' | 'severity'>>,
): Finding {
  const passLike = status === 'pass' || status === 'not_applicable';
  return {
    ruleCode: ctx.rule.code,
    ruleName: ctx.rule.name,
    category: ctx.rule.category,
    status,
    // Passing/NA findings carry no severity weight.
    severity: passLike ? 'info' : (extra?.severity ?? ctx.rule.severity),
    message,
    evidence: extra?.evidence,
    remediation: passLike ? undefined : ctx.rule.remediation,
  };
}

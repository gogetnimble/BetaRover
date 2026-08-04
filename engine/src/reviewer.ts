/** Orchestrates the deterministic + AI hybrid review of a single flow. */
import { parseFlow } from './flowModel.js';
import { evaluatorRegistry } from './rules/evaluators.js';
import type {
  Finding,
  FlowReviewInput,
  FlowReviewResult,
  ReviewOptions,
  ReviewScore,
  ReviewRule,
  Ruleset,
  Severity,
} from './types.js';

const SEVERITY_WEIGHT: Record<Severity, number> = {
  info: 0,
  warning: 1,
  error: 3,
  critical: 6,
};

/** Worst outcome across a set of findings for the same rule. */
function worstStatus(findings: Finding[]): Finding['status'] {
  const order = { not_applicable: 0, pass: 1, warning: 2, fail: 3 } as const;
  let worst: Finding['status'] = 'not_applicable';
  for (const f of findings) if (order[f.status] > order[worst]) worst = f.status;
  return worst;
}

/**
 * Compute a 0–100 compliance score.
 *
 * Each *applicable* rule (one that produced a pass/warning/fail, i.e. was not
 * N/A) has a maximum penalty of `weight × severityWeight(rule.severity)`. Its
 * actual penalty is the full amount if it failed, half if it only warned, and
 * zero if it passed. The score is `1 − Σpenalty / Σmaxpenalty`, so it measures
 * "of the standards that applied to this flow, how many did it meet", weighted
 * by how much each matters — and is unaffected by rules that were N/A.
 */
export function scoreFindings(findings: Finding[], rules: ReviewRule[]): ReviewScore {
  const bySeverity: Record<Severity, number> = { info: 0, warning: 0, error: 0, critical: 0 };
  let passed = 0;
  let failed = 0;
  let warnings = 0;
  let notApplicable = 0;

  for (const f of findings) {
    switch (f.status) {
      case 'pass':
        passed++;
        break;
      case 'warning':
        warnings++;
        bySeverity[f.severity]++;
        break;
      case 'fail':
        failed++;
        bySeverity[f.severity]++;
        break;
      case 'not_applicable':
        notApplicable++;
        break;
    }
  }

  const ruleByCode = new Map(rules.map((r) => [r.code, r]));
  const grouped = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = grouped.get(f.ruleCode) ?? [];
    list.push(f);
    grouped.set(f.ruleCode, list);
  }

  let penalty = 0;
  let maxPenalty = 0;
  for (const [code, group] of grouped) {
    const rule = ruleByCode.get(code);
    const status = worstStatus(group);
    if (status === 'not_applicable') continue;
    const max = (rule?.weight ?? 1) * SEVERITY_WEIGHT[rule?.severity ?? 'warning'];
    maxPenalty += max;
    if (status === 'fail') penalty += max;
    else if (status === 'warning') penalty += max / 2;
  }

  const score = maxPenalty === 0 ? 100 : Math.round((1 - penalty / maxPenalty) * 100);
  return {
    score: Math.max(0, Math.min(100, score)),
    passed,
    failed,
    warnings,
    notApplicable,
    bySeverity,
  };
}

/** Review one flow. Deterministic rules always run; the AI pass is opt-in. */
export async function reviewFlow(
  input: FlowReviewInput,
  ruleset: Ruleset,
  options: ReviewOptions = {},
): Promise<FlowReviewResult> {
  const flow = parseFlow(input.displayName, input.clientData);
  const findings: Finding[] = [];

  for (const rule of ruleset.rules) {
    if (!rule.enabled) continue;
    if (rule.evaluator === 'ai') continue; // handled in the AI pass
    const evaluator = evaluatorRegistry[rule.evaluator];
    if (!evaluator) {
      findings.push({
        ruleCode: rule.code,
        ruleName: rule.name,
        category: rule.category,
        status: 'not_applicable',
        severity: 'info',
        message: `No evaluator registered for "${rule.evaluator}".`,
      });
      continue;
    }
    findings.push(...evaluator({ flow, inventory: input.inventory, rule }));
  }

  if (options.ai && options.aiReviewer) {
    const aiFindings = await options.aiReviewer.review(flow, ruleset, findings);
    findings.push(...aiFindings.map((f) => ({ ...f, aiGenerated: true })));
  }

  return {
    displayName: input.displayName,
    flowId: input.inventory?.flowId,
    findings,
    score: scoreFindings(findings, ruleset.rules),
  };
}

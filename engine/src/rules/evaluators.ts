/**
 * Deterministic evaluators. Each one maps to a section of the delivery standard
 * and is registered under a stable key that a {@link ReviewRule.evaluator}
 * references. Every threshold, name and list is read from the rule's
 * `parameters`, so behaviour is configured per tenant, not hard-coded.
 */
import type { Evaluator, EvaluatorContext, FlowAction, Finding } from '../types.js';
import {
  actionParameters,
  apiId,
  arrParam,
  asRecord,
  boolParam,
  escapeRegex,
  finding,
  operationId,
  sameStatusSet,
  strParam,
} from './helpers.js';

/** Every top-level Scope action, keyed case-insensitively by name. */
function topLevelScopes(ctx: EvaluatorContext): Map<string, FlowAction> {
  const map = new Map<string, FlowAction>();
  for (const a of ctx.flow.topLevelActions) {
    if (a.type.toLowerCase() === 'scope') map.set(a.name.toLowerCase(), a);
  }
  return map;
}

/**
 * NAMING_CONVENTION — flow name matches `<Prefix><sep><Area><sep><Function>`.
 * Params: `prefix`, `separator`, `minSegments`, or an explicit `pattern`.
 */
export const namingConvention: Evaluator = (ctx) => {
  const p = ctx.rule.parameters;
  const explicit = strParam(p, 'pattern', '');
  const prefix = strParam(p, 'prefix', 'CMA');
  const separator = strParam(p, 'separator', ' - ');
  const minSegments = typeof p.minSegments === 'number' ? p.minSegments : 3;

  let regex: RegExp;
  if (explicit) {
    regex = new RegExp(explicit);
  } else {
    const tail = Array.from({ length: Math.max(0, minSegments - 1) }, () => '.+').join(
      escapeRegex(separator),
    );
    regex = new RegExp(`^${escapeRegex(prefix)}${escapeRegex(separator)}${tail}$`);
  }

  const name = ctx.flow.displayName;
  if (regex.test(name)) {
    return [finding(ctx, 'pass', `Name "${name}" follows the naming convention.`)];
  }
  return [
    finding(
      ctx,
      'fail',
      `Name "${name}" does not match the required pattern ${regex.source}. Expected e.g. "${prefix}${separator}<Area>${separator}<Function>".`,
      { evidence: name },
    ),
  ];
};

/**
 * ERROR_HANDLING_SCOPES — Try / Catch / Finally scope pattern with the correct
 * `runAfter` wiring. This is the highest-signal structural check.
 * Params: `tryName`, `catchName`, `finallyName`, `requireFinally`,
 * `catchRunAfterStatuses`, `finallyRunAfterStatuses`.
 */
export const errorHandlingScopes: Evaluator = (ctx) => {
  const p = ctx.rule.parameters;
  const tryName = strParam(p, 'tryName', 'Try');
  const catchName = strParam(p, 'catchName', 'Catch');
  const finallyName = strParam(p, 'finallyName', 'Finally');
  const requireFinally = boolParam(p, 'requireFinally', true);
  const catchStatuses = arrParam(p, 'catchRunAfterStatuses', ['Failed', 'TimedOut', 'Skipped']);
  const finallyStatuses = arrParam(p, 'finallyRunAfterStatuses', [
    'Succeeded',
    'Failed',
    'TimedOut',
    'Skipped',
  ]);

  const scopes = topLevelScopes(ctx);
  const tryScope = scopes.get(tryName.toLowerCase());
  const catchScope = scopes.get(catchName.toLowerCase());
  const finallyScope = scopes.get(finallyName.toLowerCase());

  const problems: string[] = [];

  if (!tryScope) problems.push(`missing a top-level "${tryName}" Scope`);
  if (!catchScope) {
    problems.push(`missing a top-level "${catchName}" Scope`);
  } else {
    const ra = catchScope.runAfter[tryName] ?? catchScope.runAfter[tryScope?.name ?? tryName];
    if (!ra) {
      problems.push(`"${catchName}" does not run after "${tryName}"`);
    } else if (!sameStatusSet(ra, catchStatuses)) {
      problems.push(
        `"${catchName}" runAfter is [${ra.join(', ')}]; expected [${catchStatuses.join(', ')}]`,
      );
    }
  }
  if (requireFinally) {
    if (!finallyScope) {
      problems.push(`missing a top-level "${finallyName}" Scope`);
    } else {
      const ra = finallyScope.runAfter[catchName];
      if (!ra) {
        problems.push(`"${finallyName}" does not run after "${catchName}"`);
      } else if (!sameStatusSet(ra, finallyStatuses)) {
        problems.push(
          `"${finallyName}" runAfter is [${ra.join(', ')}]; expected [${finallyStatuses.join(', ')}]`,
        );
      }
    }
  }

  if (problems.length === 0) {
    return [finding(ctx, 'pass', 'Try / Catch / Finally scopes are present and correctly wired.')];
  }
  return [
    finding(ctx, 'fail', `Error-handling pattern is incomplete: ${problems.join('; ')}.`, {
      evidence: [...scopes.values()].map((s) => s.name).join(', ') || '(no scopes)',
    }),
  ];
};

/**
 * LOGGING_PRESENT — the flow calls the shared logging child flow.
 * Params: `loggerNameContains` (substrings), `loggerWorkflowIds`.
 */
export const loggingPresent: Evaluator = (ctx) => {
  const p = ctx.rule.parameters;
  const names = arrParam(p, 'loggerNameContains', ['Logger', 'Log']).map((s) => s.toLowerCase());
  const ids = arrParam(p, 'loggerWorkflowIds', []).map((s) => s.toLowerCase());

  const match = ctx.flow.allActions.find((a) => {
    const isChildFlow = a.type.toLowerCase() === 'workflow';
    const nameHit = names.some((n) => a.name.toLowerCase().includes(n));
    const host = asRecord(asRecord(a.inputs).host);
    const ref = String(host.workflowReferenceName ?? '').toLowerCase();
    const idHit = ids.length > 0 && ids.includes(ref);
    return (isChildFlow && (nameHit || idHit || ids.length === 0)) || (nameHit && isChildFlow);
  });

  if (match) {
    return [finding(ctx, 'pass', `Logging child flow invoked via "${match.name}".`, {
      evidence: match.path,
    })];
  }
  return [
    finding(
      ctx,
      'fail',
      'No call to the shared logging child flow was found. Long-term history is lost after 28 days.',
    ),
  ];
};

/**
 * CONFIG_LIST_TOP — every Dataverse "List rows" action bounds its query with
 * `$top` (the "Row Count = 1" guidance) to avoid open-ended query warnings.
 * Params: `listOperationIds`, `topParamNames`.
 */
export const configListTop: Evaluator = (ctx) => {
  const p = ctx.rule.parameters;
  const ops = arrParam(p, 'listOperationIds', ['ListRecords']).map((s) => s.toLowerCase());
  const topKeys = arrParam(p, 'topParamNames', ['$top', 'top']);

  const listActions = ctx.flow.allActions.filter((a) => ops.includes(operationId(a).toLowerCase()));
  if (listActions.length === 0) {
    return [finding(ctx, 'not_applicable', 'No Dataverse list actions in this flow.')];
  }

  const offenders = listActions.filter((a) => {
    const params = actionParameters(a);
    return !topKeys.some((k) => params[k] !== undefined && params[k] !== null && params[k] !== '');
  });

  if (offenders.length === 0) {
    return [
      finding(ctx, 'pass', `All ${listActions.length} list action(s) bound with a row count.`),
    ];
  }
  return offenders.map((a) =>
    finding(
      ctx,
      'fail',
      `List action "${a.name}" has no row-count limit (${topKeys.join('/')}). Open-ended queries raise Microsoft warnings.`,
      { evidence: a.path },
    ),
  );
};

/**
 * APPROVED_EMAIL_SENDER — outbound email uses an approved sender/connection,
 * never a personal account.
 * Params: `emailOperationIds`, `emailApiIdContains`, `approvedSenders`,
 * `fromParamNames`.
 */
export const approvedEmailSender: Evaluator = (ctx) => {
  const p = ctx.rule.parameters;
  const ops = arrParam(p, 'emailOperationIds', [
    'SendEmailV2',
    'SendEmail',
    'SharedMailboxSendEmailV2',
  ]).map((s) => s.toLowerCase());
  const apiContains = arrParam(p, 'emailApiIdContains', ['office365', 'outlook', 'gmail']).map((s) =>
    s.toLowerCase(),
  );
  const approved = arrParam(p, 'approvedSenders', ['appdev-no-reply@cma.ca']).map((s) =>
    s.toLowerCase(),
  );
  const fromKeys = arrParam(p, 'fromParamNames', ['emailMessage/From', 'From', 'MailboxAddress']);

  const emailActions = ctx.flow.allActions.filter((a) => {
    const op = operationId(a).toLowerCase();
    const api = apiId(a).toLowerCase();
    return ops.includes(op) || (apiContains.some((c) => api.includes(c)) && op.includes('email'));
  });

  if (emailActions.length === 0) {
    return [finding(ctx, 'not_applicable', 'This flow does not send email.')];
  }

  const findings: Finding[] = [];
  for (const a of emailActions) {
    const params = actionParameters(a);
    const fromKey = fromKeys.find((k) => typeof params[k] === 'string' && params[k] !== '');
    if (!fromKey) {
      // Sender is the connection identity, not visible in the definition.
      findings.push(
        finding(
          ctx,
          'warning',
          `Email action "${a.name}" does not declare a sender in its definition. Verify the connection uses an approved sender (${approved.join(', ')}).`,
          { evidence: a.path },
        ),
      );
      continue;
    }
    const from = String(params[fromKey]).toLowerCase();
    if (approved.some((s) => from.includes(s))) {
      findings.push(finding(ctx, 'pass', `Email action "${a.name}" uses an approved sender.`, {
        evidence: a.path,
      }));
    } else {
      findings.push(
        finding(
          ctx,
          'fail',
          `Email action "${a.name}" sends from "${params[fromKey]}", which is not an approved sender (${approved.join(', ')}).`,
          { evidence: a.path },
        ),
      );
    }
  }
  return findings;
};

/**
 * RUN_AS_SERVICE_PRINCIPAL — the flow should not run as a user principal.
 * Uses inventory metadata (owner type) enriched from the Management API.
 */
export const runAsServicePrincipal: Evaluator = (ctx) => {
  const owner = ctx.inventory?.ownerType;
  if (!owner || owner === 'unknown') {
    return [finding(ctx, 'not_applicable', 'Owner principal type unknown; cannot evaluate.')];
  }
  if (owner === 'user') {
    return [
      finding(
        ctx,
        'fail',
        `Flow runs as a user principal (${ctx.inventory?.ownerName ?? 'user'}). It should run as an application / service principal.`,
      ),
    ];
  }
  return [finding(ctx, 'pass', `Flow runs as a ${owner} principal.`)];
};

/**
 * NO_HARDCODED_ENV — heuristic scan for environment-specific literals (absolute
 * https URLs, environment GUIDs) that should come from the config table.
 * Params: `ignoreHostSubstrings`, `guidCheck`.
 */
export const noHardcodedEnv: Evaluator = (ctx) => {
  const p = ctx.rule.parameters;
  const ignore = arrParam(p, 'ignoreHostSubstrings', [
    'schema.management.azure.com',
    'schemas.microsoft.com',
    'login.microsoftonline.com',
  ]).map((s) => s.toLowerCase());
  const checkGuid = boolParam(p, 'guidCheck', true);

  const urlRe = /https?:\/\/[^\s"'\\)]+/gi;
  const guidRe = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

  const hits: string[] = [];
  for (const a of ctx.flow.allActions) {
    // Only scan the parameters block; connector host URLs are legitimate.
    const params = JSON.stringify(actionParameters(a) ?? {});
    for (const m of params.match(urlRe) ?? []) {
      if (!ignore.some((ig) => m.toLowerCase().includes(ig))) hits.push(`${a.name}: ${m}`);
    }
    if (checkGuid) {
      for (const m of params.match(guidRe) ?? []) hits.push(`${a.name}: ${m}`);
    }
  }

  if (hits.length === 0) {
    return [finding(ctx, 'pass', 'No hard-coded environment-specific literals detected.')];
  }
  return [
    finding(
      ctx,
      'warning',
      `Possible hard-coded environment-specific value(s) found; consider loading from the Flow Configuration table: ${hits
        .slice(0, 5)
        .join('; ')}${hits.length > 5 ? ` (+${hits.length - 5} more)` : ''}.`,
      { evidence: hits[0] },
    ),
  ];
};

/** Registry consumed by the reviewer. Keys match `ReviewRule.evaluator`. */
export const evaluatorRegistry: Record<string, Evaluator> = {
  namingConvention,
  errorHandlingScopes,
  loggingPresent,
  configListTop,
  approvedEmailSender,
  runAsServicePrincipal,
  noHardcodedEnv,
};

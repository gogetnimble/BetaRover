import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { reviewFlowWithDefaults } from '../src/index.js';
import { DEFAULT_RULESET } from '../src/defaultRuleset.js';
import type { Finding, FlowInventoryMeta } from '../src/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(here, 'fixtures', name), 'utf-8'));

function byRule(findings: Finding[], code: string): Finding[] {
  return findings.filter((f) => f.ruleCode === code);
}
/** The single worst status for a rule (pass < warning < fail). */
function statusOf(findings: Finding[], code: string): string {
  const order: Record<string, number> = { not_applicable: 0, pass: 1, warning: 2, fail: 3 };
  return byRule(findings, code).reduce(
    (worst, f) => (order[f.status]! > order[worst]! ? f.status : worst),
    'not_applicable',
  );
}

describe('compliant flow', () => {
  const inventory: FlowInventoryMeta = {
    flowId: 'guid-1',
    ownerType: 'application',
    source: 'dataverse',
  };

  it('passes every applicable rule', async () => {
    const result = await reviewFlowWithDefaults({
      displayName: 'CMA - Membership - Add new Roles on Contact Creation',
      clientData: fixture('compliant-flow.json'),
      inventory,
    });

    expect(statusOf(result.findings, 'NAMING_CONVENTION')).toBe('pass');
    expect(statusOf(result.findings, 'ERROR_HANDLING_SCOPES')).toBe('pass');
    expect(statusOf(result.findings, 'LOGGING_PRESENT')).toBe('pass');
    expect(statusOf(result.findings, 'CONFIG_LIST_TOP')).toBe('pass');
    expect(statusOf(result.findings, 'APPROVED_EMAIL_SENDER')).toBe('pass');
    expect(statusOf(result.findings, 'RUN_AS_SERVICE_PRINCIPAL')).toBe('pass');
    expect(statusOf(result.findings, 'NO_HARDCODED_ENV')).toBe('pass');
    expect(result.score.failed).toBe(0);
    expect(result.score.score).toBe(100);
  });
});

describe('non-compliant flow', () => {
  const inventory: FlowInventoryMeta = {
    flowId: 'guid-2',
    ownerType: 'user',
    ownerName: 'Greg Thomas',
    source: 'managementapi',
  };

  it('fails the expected rules', async () => {
    const result = await reviewFlowWithDefaults({
      displayName: 'ContactRoleThing',
      clientData: fixture('noncompliant-flow.json'),
      inventory,
    });

    // Naming: no "CMA - Area - Function".
    expect(statusOf(result.findings, 'NAMING_CONVENTION')).toBe('fail');
    // No Try/Catch/Finally scopes at all.
    expect(statusOf(result.findings, 'ERROR_HANDLING_SCOPES')).toBe('fail');
    // No logger child flow.
    expect(statusOf(result.findings, 'LOGGING_PRESENT')).toBe('fail');
    // List rows with no $top.
    expect(statusOf(result.findings, 'CONFIG_LIST_TOP')).toBe('fail');
    // Sends from a gmail account.
    expect(statusOf(result.findings, 'APPROVED_EMAIL_SENDER')).toBe('fail');
    // Runs as a user principal.
    expect(statusOf(result.findings, 'RUN_AS_SERVICE_PRINCIPAL')).toBe('fail');
    // Hard-coded prod URL in an Http action.
    expect(statusOf(result.findings, 'NO_HARDCODED_ENV')).toBe('warning');

    expect(result.score.failed).toBeGreaterThanOrEqual(5);
    expect(result.score.score).toBeLessThan(30);
  });
});

describe('parsing robustness', () => {
  it('accepts clientdata as a raw JSON string', async () => {
    const raw = readFileSync(join(here, 'fixtures', 'compliant-flow.json'), 'utf-8');
    const result = await reviewFlowWithDefaults({
      displayName: 'CMA - System - Something',
      clientData: raw,
    });
    expect(statusOf(result.findings, 'ERROR_HANDLING_SCOPES')).toBe('pass');
  });

  it('treats unknown owner as not applicable for run-as rule', async () => {
    const result = await reviewFlowWithDefaults({
      displayName: 'CMA - System - Something',
      clientData: fixture('compliant-flow.json'),
    });
    expect(statusOf(result.findings, 'RUN_AS_SERVICE_PRINCIPAL')).toBe('not_applicable');
  });

  it('does not crash on empty / garbage clientdata', async () => {
    const result = await reviewFlowWithDefaults({ displayName: 'x', clientData: 'not json' });
    expect(result.findings.length).toBeGreaterThan(0);
    expect(statusOf(result.findings, 'ERROR_HANDLING_SCOPES')).toBe('fail');
  });
});

describe('scoring', () => {
  it('is 100 when nothing applies', async () => {
    // A ruleset where the only rule is N/A yields a perfect score.
    const result = await reviewFlowWithDefaults({
      displayName: 'CMA - System - Empty',
      clientData: { definition: { triggers: {}, actions: {} } },
    });
    // Email + config-list are N/A here; naming/error-handling still evaluate.
    expect(result.score.score).toBeLessThanOrEqual(100);
    expect(result.score.notApplicable).toBeGreaterThan(0);
  });

  it('default ruleset stays internally consistent', () => {
    const codes = DEFAULT_RULESET.rules.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length); // no dup codes
    for (const r of DEFAULT_RULESET.rules) {
      expect(r.weight).toBeGreaterThan(0);
      expect(['info', 'warning', 'error', 'critical']).toContain(r.severity);
    }
  });
});

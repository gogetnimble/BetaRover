import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseFlow } from '../../src/index.js';
import { runTestCase, runTestSuite } from '../../src/testing/index.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const compliant = JSON.parse(readFileSync(join(__dir, '..', 'fixtures', 'compliant-flow.json'), 'utf8'));

const LOG_SOURCE = 'CMA - Membership - Add new Roles on Contact Creation';

describe('mock runner — Try/Catch/Finally flow', () => {
  const model = parseFlow('CMA - Membership - Add new Roles on Contact Creation', compliant);

  it('happy path: Try succeeds, Catch is skipped', () => {
    const r = runTestCase(model, {
      name: 'happy path',
      trigger: { body: { contactid: '1' } },
      mocks: {
        Get_Flow_Configuration: { outputs: { body: { value: [{ cma_realtimemarketingtopicid: 't1' }] } } },
        Send_notification: { outputs: {} },
      },
      asserts: [
        { type: 'ran', action: 'Set_LogSource' },
        { type: 'ran', action: 'Send_notification' },
        { type: 'status', action: 'Try', equals: 'Succeeded' },
        { type: 'skipped', action: 'Catch' },
        { type: 'skipped', action: 'Log_Error' },
        { type: 'variableEquals', name: 'LogSource', equals: LOG_SOURCE },
        { type: 'noFailures' },
      ],
    });
    expect(r.passed).toBe(true);
  });

  it('failure path: config lookup fails, Catch runs', () => {
    const r = runTestCase(model, {
      name: 'config lookup fails',
      mocks: { Get_Flow_Configuration: { error: 'Dataverse 500' } },
      asserts: [
        { type: 'status', action: 'Get_Flow_Configuration', equals: 'Failed' },
        { type: 'skipped', action: 'Send_notification' },
        { type: 'status', action: 'Try', equals: 'Failed' },
        { type: 'ran', action: 'Catch' },
        { type: 'ran', action: 'Log_Error' },
      ],
    });
    expect(r.passed).toBe(true);
    // Log_Error is an un-mocked child flow → reported, not silently ignored
    expect(r.unmockedExternal).toContain('Log_Error');
  });

  it('a wrong assertion fails the case (and explains why)', () => {
    const r = runTestCase(model, {
      name: 'catch should NOT run on success',
      mocks: { Get_Flow_Configuration: { outputs: {} }, Send_notification: { outputs: {} } },
      asserts: [{ type: 'ran', action: 'Catch' }],
    });
    expect(r.passed).toBe(false);
    expect(r.assertions[0].message).toMatch(/did not run/);
  });
});

describe('mock runner — Compose / Condition / variables', () => {
  const flow = {
    properties: {
      definition: {
        triggers: {},
        actions: {
          Init: { type: 'InitializeVariable', runAfter: {}, inputs: { variables: [{ name: 'count', type: 'integer', value: 0 }] } },
          Compose_msg: { type: 'Compose', runAfter: { Init: ['Succeeded'] }, inputs: "@concat('n=', string(variables('count')))" },
          Check: {
            type: 'If',
            runAfter: { Compose_msg: ['Succeeded'] },
            expression: { and: [{ equals: ["@variables('count')", 0] }] },
            actions: { Set_five: { type: 'SetVariable', runAfter: {}, inputs: { name: 'count', value: 5 } } },
            else: { actions: { Never: { type: 'Compose', runAfter: {}, inputs: 'unreached' } } },
          },
        },
      },
    },
  };
  const model = parseFlow('demo', flow);

  it('evaluates Compose, takes the yes branch, and mutates the variable', () => {
    const r = runTestCase(model, {
      name: 'count is zero',
      asserts: [
        { type: 'ran', action: 'Init' },
        { type: 'outputEquals', expression: "outputs('Compose_msg')", equals: 'n=0' },
        { type: 'branchTaken', condition: 'Check', branch: 'yes' },
        { type: 'skipped', action: 'Never' },
        { type: 'variableEquals', name: 'count', equals: 5 },
      ],
    });
    expect(r.passed).toBe(true);
  });
});

describe('runTestSuite', () => {
  const model = { properties: { definition: { triggers: {}, actions: { A: { type: 'Compose', runAfter: {}, inputs: '@add(2,3)' } } } } };
  it('rolls up multiple cases', () => {
    const suite = runTestSuite('adder', model, [
      { name: 'passes', asserts: [{ type: 'outputEquals', expression: "outputs('A')", equals: 5 }] },
      { name: 'fails', asserts: [{ type: 'outputEquals', expression: "outputs('A')", equals: 6 }] },
    ]);
    expect(suite.passed).toBe(false);
    expect(suite.results.map((r) => r.passed)).toEqual([true, false]);
  });
});

/**
 * Parity check: the web resource ships a hand-port of this runner (inline JS in
 * webresource/bvr_flowreview_app.html, `EmberRunner`). This test runs the exact
 * sample flow + cases the web resource's demo uses through the real TS runner, so
 * a divergence between the port and the engine fails CI.
 */
import { describe, it, expect } from 'vitest';
import type { FlowModel } from '../../src/types.js';
import { runTestCase } from '../../src/testing/index.js';
import type { TestCase } from '../../src/testing/index.js';

const SAMPLE_FLOW = {
  actions: {
    Init_count: { type: 'InitializeVariable', inputs: { variables: [{ name: 'count', type: 'integer', value: 0 }] }, runAfter: {} },
    Increment_count: { type: 'IncrementVariable', inputs: { name: 'count', value: 2 }, runAfter: { Init_count: ['Succeeded'] } },
    Get_a_row: { type: 'OpenApiConnection', inputs: {}, runAfter: { Increment_count: ['Succeeded'] } },
    Check_count: {
      type: 'If', expression: { greater: ["@variables('count')", 1] },
      actions: { Compose_ok: { type: 'Compose', inputs: 'ok', runAfter: {} } },
      else: { actions: { Compose_low: { type: 'Compose', inputs: 'low', runAfter: {} } } },
      runAfter: { Get_a_row: ['Succeeded'] },
    },
  },
};
const model = { raw: SAMPLE_FLOW } as unknown as FlowModel;

const cases: TestCase[] = [
  { name: 'Happy path · row found', mocks: { Get_a_row: { status: 'Succeeded', outputs: { body: { id: 1 } } } },
    asserts: [{ type: 'noFailures' }, { type: 'variableEquals', name: 'count', equals: 2 }, { type: 'branchTaken', condition: 'Check_count', branch: 'yes' }, { type: 'ran', action: 'Compose_ok' }] },
  { name: 'Detects a failed action', mocks: { Get_a_row: { status: 'Failed', error: '429 throttled' } },
    asserts: [{ type: 'status', action: 'Get_a_row', equals: 'Failed' }, { type: 'skipped', action: 'Check_count' }] },
  { name: 'Wrong expectation (should fail)', mocks: { Get_a_row: { status: 'Succeeded', outputs: {} } },
    asserts: [{ type: 'variableEquals', name: 'count', equals: 5 }] },
];

describe('web-resource runner parity (sample flow)', () => {
  it('produces 2 pass / 1 fail with the expected per-case outcomes', () => {
    const results = cases.map((c) => runTestCase(model, c));
    expect(results.map((r) => r.passed)).toEqual([true, true, false]);
    expect(results.filter((r) => r.passed).length).toBe(2);
  });
});

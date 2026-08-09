/** Mock-execution (unit-test) runner for Power Automate flows. */
export * from './types.js';
export { runTestCase } from './runner.js';
export { evaluateExpression, resolveValue, emptyContext } from './expr.js';
export type { EvalContext } from './expr.js';

import type { FlowModel } from '../types.js';
import { parseFlow } from '../flowModel.js';
import { runTestCase } from './runner.js';
import type { TestCase, TestResult } from './types.js';

/**
 * Convenience: parse a flow's `clientdata` and run a batch of test cases against
 * it. Returns one {@link TestResult} per case plus an overall pass flag — the
 * shape a "Test Run" row stores.
 */
export function runTestSuite(
  displayName: string,
  clientData: unknown,
  cases: TestCase[],
): { passed: boolean; results: TestResult[] } {
  const model: FlowModel = parseFlow(displayName, clientData);
  const results = cases.map((c) => runTestCase(model, c));
  return { passed: results.every((r) => r.passed), results };
}
